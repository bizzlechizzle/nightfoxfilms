/**
 * Couples Repository
 *
 * CRUD operations for wedding couples/projects with workflow tracking.
 * Manages the video workflow: booked -> shot -> ingested -> editing -> delivered -> archived
 */

import { getDatabase } from '../main/database';
import type { Couple, CoupleInput, CoupleWithFiles, File, CoupleStatus } from '@nightfox/core';
import path from 'path';

// Status date field mapping
const STATUS_DATE_FIELDS: Record<CoupleStatus, string | null> = {
  booked: null, // No date field for booked (use created_at)
  shot: 'date_shot',
  ingested: 'date_ingested',
  editing: 'date_editing_started',
  delivered: 'date_delivered',
  archived: 'date_archived',
};

export interface DashboardStats {
  byStatus: Record<CoupleStatus, number>;
  deliveredThisMonth: number;
  upcomingWeddings: Array<{
    couple: Couple;
    daysUntil: number;
  }>;
  recentActivity: Array<{
    couple: Couple;
    action: string;
    timestamp: string;
  }>;
}

export interface MonthlyStats {
  weddingsShot: number;
  weddingsDelivered: number;
  inProgress: number;
  filesImported: number;
}

export interface YearlyStats {
  totalWeddings: number;
  totalDelivered: number;
  deliveryRate: number;
  avgDaysToDelivery: number;
}

export class CouplesRepository {
  /**
   * Find all couples
   */
  findAll(): Couple[] {
    const db = getDatabase();
    return db.prepare('SELECT * FROM couples ORDER BY wedding_date DESC, name').all() as Couple[];
  }

  /**
   * Find couple by ID
   */
  findById(id: number): Couple | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM couples WHERE id = ?').get(id) as Couple | undefined;
    return row ?? null;
  }

  /**
   * Find couple with files
   */
  findWithFiles(id: number): CoupleWithFiles | null {
    const couple = this.findById(id);
    if (!couple) return null;

    const db = getDatabase();
    const files = db
      .prepare('SELECT * FROM files WHERE couple_id = ? AND is_hidden = 0 ORDER BY recorded_at DESC')
      .all(id) as File[];

    return { ...couple, files };
  }

  /**
   * Create a new couple
   */
  create(input: CoupleInput): Couple {
    const db = getDatabase();

    // Generate folder name
    const folderName = this.generateFolderName(input.name, input.wedding_date ?? null);

    const result = db
      .prepare(
        `INSERT INTO couples (name, wedding_date, folder_name, notes)
         VALUES (?, ?, ?, ?)`
      )
      .run(input.name, input.wedding_date ?? null, folderName, input.notes ?? null);

    return this.findById(result.lastInsertRowid as number)!;
  }

  /**
   * Update a couple
   */
  update(id: number, input: Partial<CoupleInput>): Couple | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const db = getDatabase();
    const updates: string[] = [];
    const values: unknown[] = [];

    if (input.name !== undefined) {
      updates.push('name = ?');
      values.push(input.name);

      // Regenerate folder name if name changes
      const folderName = this.generateFolderName(
        input.name,
        input.wedding_date ?? existing.wedding_date
      );
      updates.push('folder_name = ?');
      values.push(folderName);
    }
    if (input.wedding_date !== undefined) {
      updates.push('wedding_date = ?');
      values.push(input.wedding_date);

      // Regenerate folder name if date changes
      if (input.name === undefined) {
        const folderName = this.generateFolderName(existing.name, input.wedding_date);
        updates.push('folder_name = ?');
        values.push(folderName);
      }
    }
    if (input.notes !== undefined) {
      updates.push('notes = ?');
      values.push(input.notes);
    }

    if (updates.length === 0) return existing;

    values.push(id);
    db.prepare(`UPDATE couples SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return this.findById(id);
  }

  /**
   * Delete a couple
   */
  delete(id: number): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM couples WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Find couples by wedding date range
   */
  findByDateRange(startDate: string, endDate: string): Couple[] {
    const db = getDatabase();
    return db
      .prepare(
        'SELECT * FROM couples WHERE wedding_date >= ? AND wedding_date <= ? ORDER BY wedding_date'
      )
      .all(startDate, endDate) as Couple[];
  }

  /**
   * Find couples by name search
   */
  search(query: string): Couple[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM couples WHERE name LIKE ? ORDER BY wedding_date DESC, name')
      .all(`%${query}%`) as Couple[];
  }

  /**
   * Get couple statistics
   */
  getStats(id: number): { fileCount: number; totalDuration: number } | null {
    const couple = this.findById(id);
    if (!couple) return null;

    return {
      fileCount: couple.file_count,
      totalDuration: couple.total_duration_seconds,
    };
  }

  /**
   * Update couple export timestamp
   */
  updateExportTimestamp(id: number, exportPath: string): void {
    const db = getDatabase();
    db.prepare(
      'UPDATE couples SET last_export_at = CURRENT_TIMESTAMP, export_path = ? WHERE id = ?'
    ).run(exportPath, id);
  }

  /**
   * Generate folder name from couple name and date
   * Format: "2024-06-15-smith-jones"
   */
  private generateFolderName(name: string, weddingDate: string | null): string {
    // Sanitize name: lowercase, replace spaces/special chars with hyphens
    const sanitizedName = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    if (weddingDate) {
      return `${weddingDate}-${sanitizedName}`;
    }

    return sanitizedName;
  }

  /**
   * Export couple data to JSON
   */
  exportToJson(id: number): object | null {
    const couple = this.findWithFiles(id);
    if (!couple) return null;

    const db = getDatabase();

    // Get all scenes for this couple's files
    const fileIds = couple.files.map((f) => f.id);
    let scenes: any[] = [];
    if (fileIds.length > 0) {
      const placeholders = fileIds.map(() => '?').join(',');
      scenes = db
        .prepare(`SELECT * FROM scenes WHERE file_id IN (${placeholders}) ORDER BY file_id, scene_number`)
        .all(...fileIds);
    }

    // Get all exports for this couple
    const exports = db
      .prepare('SELECT * FROM exports WHERE couple_id = ? ORDER BY created_at DESC')
      .all(id);

    return {
      couple: {
        id: couple.id,
        name: couple.name,
        wedding_date: couple.wedding_date,
        notes: couple.notes,
        file_count: couple.file_count,
        total_duration_seconds: couple.total_duration_seconds,
        created_at: couple.created_at,
        updated_at: couple.updated_at,
      },
      files: couple.files.map((f) => ({
        blake3: f.blake3,
        original_filename: f.original_filename,
        extension: f.extension,
        file_size: f.file_size,
        medium: f.medium,
        file_type: f.file_type,
        duration_seconds: f.duration_seconds,
        width: f.width,
        height: f.height,
        frame_rate: f.frame_rate,
        codec: f.codec,
        recorded_at: f.recorded_at,
        camera_id: f.camera_id,
        detected_make: f.detected_make,
        detected_model: f.detected_model,
      })),
      scenes,
      exports,
      exported_at: new Date().toISOString(),
    };
  }

  // ===========================================================================
  // WORKFLOW METHODS
  // ===========================================================================

  /**
   * Update couple status with timestamp tracking
   */
  updateStatus(id: number, status: CoupleStatus, notes?: string): Couple | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const db = getDatabase();
    const dateField = STATUS_DATE_FIELDS[status];

    if (dateField) {
      // Update status and set the corresponding date field
      db.prepare(
        `UPDATE couples SET status = ?, ${dateField} = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
      ).run(status, id);
    } else {
      // Just update status (for 'booked')
      db.prepare(
        'UPDATE couples SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(status, id);
    }

    return this.findById(id);
  }

  /**
   * Find couples by status
   */
  findByStatus(status: CoupleStatus): Couple[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM couples WHERE status = ? ORDER BY wedding_date DESC')
      .all(status) as Couple[];
  }

  /**
   * Get couples for a specific month (for calendar view)
   */
  getForMonth(year: number, month: number): Couple[] {
    const db = getDatabase();
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(month).padStart(2, '0')}-31`;

    return db
      .prepare(
        'SELECT * FROM couples WHERE wedding_date >= ? AND wedding_date <= ? ORDER BY wedding_date'
      )
      .all(startDate, endDate) as Couple[];
  }

  /**
   * Get dashboard statistics
   */
  getDashboardStats(): DashboardStats {
    const db = getDatabase();

    // Count by status
    const statusCounts = db
      .prepare(
        `SELECT status, COUNT(*) as count FROM couples GROUP BY status`
      )
      .all() as Array<{ status: CoupleStatus; count: number }>;

    const byStatus: Record<CoupleStatus, number> = {
      booked: 0,
      shot: 0,
      ingested: 0,
      editing: 0,
      delivered: 0,
      archived: 0,
    };

    for (const row of statusCounts) {
      if (row.status in byStatus) {
        byStatus[row.status] = row.count;
      }
    }

    // Delivered this month
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const deliveredThisMonth = db
      .prepare(
        `SELECT COUNT(*) as count FROM couples WHERE date_delivered >= ?`
      )
      .get(monthStart) as { count: number };

    // Upcoming weddings (next 30 days)
    const today = now.toISOString().split('T')[0];
    const thirtyDaysLater = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split('T')[0];

    const upcomingRows = db
      .prepare(
        `SELECT * FROM couples
         WHERE wedding_date >= ? AND wedding_date <= ? AND status = 'booked'
         ORDER BY wedding_date`
      )
      .all(today, thirtyDaysLater) as Couple[];

    const upcomingWeddings = upcomingRows.map((couple) => ({
      couple,
      daysUntil: Math.ceil(
        (new Date(couple.wedding_date!).getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
      ),
    }));

    // Recent activity (last 5 updated)
    const recentRows = db
      .prepare(
        `SELECT * FROM couples ORDER BY updated_at DESC LIMIT 5`
      )
      .all() as Couple[];

    const recentActivity = recentRows.map((couple) => ({
      couple,
      action: `Status: ${couple.status}`,
      timestamp: couple.updated_at,
    }));

    return {
      byStatus,
      deliveredThisMonth: deliveredThisMonth.count,
      upcomingWeddings,
      recentActivity,
    };
  }

  /**
   * Get monthly statistics
   */
  getMonthlyStats(year: number, month: number): MonthlyStats {
    const db = getDatabase();
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;

    // Weddings shot this month (by wedding_date)
    const shotCount = db
      .prepare(
        `SELECT COUNT(*) as count FROM couples WHERE wedding_date LIKE ?`
      )
      .get(`${monthStr}%`) as { count: number };

    // Weddings delivered this month
    const deliveredCount = db
      .prepare(
        `SELECT COUNT(*) as count FROM couples WHERE date_delivered LIKE ?`
      )
      .get(`${monthStr}%`) as { count: number };

    // In progress (not delivered or archived)
    const inProgressCount = db
      .prepare(
        `SELECT COUNT(*) as count FROM couples
         WHERE status NOT IN ('delivered', 'archived') AND wedding_date LIKE ?`
      )
      .get(`${monthStr}%`) as { count: number };

    // Files imported this month
    const filesCount = db
      .prepare(
        `SELECT COUNT(*) as count FROM files WHERE imported_at LIKE ?`
      )
      .get(`${monthStr}%`) as { count: number };

    return {
      weddingsShot: shotCount.count,
      weddingsDelivered: deliveredCount.count,
      inProgress: inProgressCount.count,
      filesImported: filesCount.count,
    };
  }

  /**
   * Get yearly statistics
   */
  getYearlyStats(year: number): YearlyStats {
    const db = getDatabase();
    const yearStr = `${year}`;

    // Total weddings this year
    const totalCount = db
      .prepare(
        `SELECT COUNT(*) as count FROM couples WHERE wedding_date LIKE ?`
      )
      .get(`${yearStr}%`) as { count: number };

    // Total delivered this year
    const deliveredCount = db
      .prepare(
        `SELECT COUNT(*) as count FROM couples WHERE date_delivered LIKE ?`
      )
      .get(`${yearStr}%`) as { count: number };

    // Calculate delivery rate
    const deliveryRate = totalCount.count > 0
      ? Math.round((deliveredCount.count / totalCount.count) * 100)
      : 0;

    // Average days to delivery (from wedding_date to date_delivered)
    const avgDaysResult = db
      .prepare(
        `SELECT AVG(julianday(date_delivered) - julianday(wedding_date)) as avg_days
         FROM couples
         WHERE date_delivered IS NOT NULL AND wedding_date IS NOT NULL AND wedding_date LIKE ?`
      )
      .get(`${yearStr}%`) as { avg_days: number | null };

    return {
      totalWeddings: totalCount.count,
      totalDelivered: deliveredCount.count,
      deliveryRate,
      avgDaysToDelivery: Math.round(avgDaysResult.avg_days ?? 0),
    };
  }
}

export const couplesRepository = new CouplesRepository();
