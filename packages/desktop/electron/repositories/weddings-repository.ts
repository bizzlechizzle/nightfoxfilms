/**
 * Weddings Repository
 *
 * CRUD operations for wedding photography tracking.
 * Manages the wedding workflow: imported -> culling -> editing -> delivered -> archived
 */

import { getDatabase } from '../main/database';
import { randomUUID } from 'crypto';

export type WeddingStatus = 'imported' | 'culling' | 'editing' | 'delivered' | 'archived';

export interface Wedding {
  id: string;
  partner_a_name: string;
  partner_b_name: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  wedding_date: string;
  venue_name: string | null;
  venue_city: string | null;
  venue_state: string | null;
  status: WeddingStatus;
  date_imported: string;
  date_culling_started: string | null;
  date_editing_started: string | null;
  date_delivered: string | null;
  date_archived: string | null;
  total_images: number;
  culled_images: number;
  edited_images: number;
  delivered_images: number;
  source_path: string | null;
  working_path: string | null;
  delivery_path: string | null;
  package_name: string | null;
  contracted_images: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface WeddingStatusHistory {
  id: string;
  wedding_id: string;
  from_status: WeddingStatus | null;
  to_status: WeddingStatus;
  changed_at: string;
  notes: string | null;
}

export interface CreateWeddingInput {
  partner_a_name: string;
  partner_b_name: string;
  wedding_date: string;
  venue_name?: string;
  venue_city?: string;
  venue_state?: string;
  email?: string;
  phone?: string;
  source_path?: string;
  total_images?: number;
  package_name?: string;
  contracted_images?: number;
  notes?: string;
}

export interface UpdateWeddingInput {
  partner_a_name?: string;
  partner_b_name?: string;
  wedding_date?: string;
  venue_name?: string;
  venue_city?: string;
  venue_state?: string;
  email?: string;
  phone?: string;
  source_path?: string;
  working_path?: string;
  delivery_path?: string;
  total_images?: number;
  culled_images?: number;
  edited_images?: number;
  delivered_images?: number;
  package_name?: string;
  contracted_images?: number;
  notes?: string;
}

export interface WeddingFilters {
  status?: WeddingStatus | WeddingStatus[];
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  sortBy?: 'wedding_date' | 'date_imported' | 'display_name' | 'status';
  sortOrder?: 'asc' | 'desc';
}

export interface DashboardStats {
  byStatus: Record<WeddingStatus, number>;
  deliveredThisMonth: number;
  upcomingDeliveries: Array<{
    wedding: Wedding;
    daysUntilDue: number;
    progress: number;
  }>;
  recentActivity: Array<{
    wedding: Wedding;
    action: string;
    timestamp: string;
  }>;
}

export interface MonthlyStats {
  weddingsShot: number;
  weddingsDelivered: number;
  inProgress: number;
  imagesEdited: number;
}

export interface YearlyStats {
  totalWeddings: number;
  totalDelivered: number;
  deliveryRate: number;
  avgDaysToDelivery: number;
}

export class WeddingsRepository {
  /**
   * Generate display name from partner names
   */
  private generateDisplayName(partnerA: string, partnerB: string): string {
    const aLast = partnerA.split(' ').pop() || partnerA;
    const bLast = partnerB.split(' ').pop() || partnerB;
    return `${aLast} & ${bLast}`;
  }

  /**
   * Calculate progress percentage based on workflow status
   */
  private calculateProgress(wedding: Wedding): number {
    const statusProgress: Record<WeddingStatus, number> = {
      imported: 10,
      culling: 30,
      editing: 60,
      delivered: 90,
      archived: 100,
    };

    let progress = statusProgress[wedding.status] || 0;

    // Refine based on image counts
    if (wedding.status === 'culling' && wedding.total_images > 0) {
      const cullProgress = (wedding.culled_images / wedding.total_images) * 20;
      progress = 10 + cullProgress;
    } else if (wedding.status === 'editing') {
      const target = wedding.contracted_images || wedding.culled_images || wedding.total_images;
      if (target > 0) {
        const editProgress = (wedding.edited_images / target) * 30;
        progress = 30 + editProgress;
      }
    }

    return Math.min(100, Math.round(progress));
  }

  /**
   * Create a new wedding
   */
  create(input: CreateWeddingInput): Wedding {
    const db = getDatabase();
    const id = randomUUID();
    const displayName = this.generateDisplayName(input.partner_a_name, input.partner_b_name);

    db.prepare(`
      INSERT INTO weddings (
        id, partner_a_name, partner_b_name, display_name, email, phone,
        wedding_date, venue_name, venue_city, venue_state,
        source_path, total_images, package_name, contracted_images, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.partner_a_name,
      input.partner_b_name,
      displayName,
      input.email ?? null,
      input.phone ?? null,
      input.wedding_date,
      input.venue_name ?? null,
      input.venue_city ?? null,
      input.venue_state ?? null,
      input.source_path ?? null,
      input.total_images ?? 0,
      input.package_name ?? null,
      input.contracted_images ?? null,
      input.notes ?? null
    );

    // Record initial status
    this.recordStatusChange(id, null, 'imported');

    return this.findById(id)!;
  }

  /**
   * Find wedding by ID
   */
  findById(id: string): Wedding | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM weddings WHERE id = ?').get(id) as Wedding | undefined;
    return row ?? null;
  }

  /**
   * Find all weddings with optional filters
   */
  findAll(filters?: WeddingFilters): Wedding[] {
    const db = getDatabase();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters?.status) {
      if (Array.isArray(filters.status)) {
        const placeholders = filters.status.map(() => '?').join(',');
        conditions.push(`status IN (${placeholders})`);
        params.push(...filters.status);
      } else {
        conditions.push('status = ?');
        params.push(filters.status);
      }
    }

    if (filters?.dateFrom) {
      conditions.push('wedding_date >= ?');
      params.push(filters.dateFrom);
    }

    if (filters?.dateTo) {
      conditions.push('wedding_date <= ?');
      params.push(filters.dateTo);
    }

    if (filters?.search) {
      conditions.push('(display_name LIKE ? OR partner_a_name LIKE ? OR partner_b_name LIKE ? OR venue_name LIKE ?)');
      const searchTerm = `%${filters.search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sortBy = filters?.sortBy || 'wedding_date';
    const sortOrder = filters?.sortOrder || 'desc';

    return db.prepare(`
      SELECT * FROM weddings ${whereClause}
      ORDER BY ${sortBy} ${sortOrder}
    `).all(...params) as Wedding[];
  }

  /**
   * Update wedding
   */
  update(id: string, input: UpdateWeddingInput): Wedding | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const db = getDatabase();
    const updates: string[] = [];
    const values: unknown[] = [];

    // Track name changes to update display name
    let partnerAName = existing.partner_a_name;
    let partnerBName = existing.partner_b_name;

    if (input.partner_a_name !== undefined) {
      updates.push('partner_a_name = ?');
      values.push(input.partner_a_name);
      partnerAName = input.partner_a_name;
    }
    if (input.partner_b_name !== undefined) {
      updates.push('partner_b_name = ?');
      values.push(input.partner_b_name);
      partnerBName = input.partner_b_name;
    }

    // Update display name if either partner name changed
    if (input.partner_a_name !== undefined || input.partner_b_name !== undefined) {
      updates.push('display_name = ?');
      values.push(this.generateDisplayName(partnerAName, partnerBName));
    }

    const fieldMap: [keyof UpdateWeddingInput, string][] = [
      ['wedding_date', 'wedding_date'],
      ['venue_name', 'venue_name'],
      ['venue_city', 'venue_city'],
      ['venue_state', 'venue_state'],
      ['email', 'email'],
      ['phone', 'phone'],
      ['source_path', 'source_path'],
      ['working_path', 'working_path'],
      ['delivery_path', 'delivery_path'],
      ['total_images', 'total_images'],
      ['culled_images', 'culled_images'],
      ['edited_images', 'edited_images'],
      ['delivered_images', 'delivered_images'],
      ['package_name', 'package_name'],
      ['contracted_images', 'contracted_images'],
      ['notes', 'notes'],
    ];

    for (const [key, column] of fieldMap) {
      if (input[key] !== undefined) {
        updates.push(`${column} = ?`);
        values.push(input[key]);
      }
    }

    if (updates.length === 0) return existing;

    values.push(id);
    db.prepare(`UPDATE weddings SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    return this.findById(id);
  }

  /**
   * Update wedding status with history tracking
   */
  updateStatus(id: string, newStatus: WeddingStatus, notes?: string): Wedding | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const db = getDatabase();
    const dateField = this.getStatusDateField(newStatus);

    db.prepare(`
      UPDATE weddings SET status = ?, ${dateField} = CURRENT_TIMESTAMP WHERE id = ?
    `).run(newStatus, id);

    this.recordStatusChange(id, existing.status, newStatus, notes);

    return this.findById(id);
  }

  /**
   * Get status date field mapping
   */
  private getStatusDateField(status: WeddingStatus): string {
    const map: Record<WeddingStatus, string> = {
      imported: 'date_imported',
      culling: 'date_culling_started',
      editing: 'date_editing_started',
      delivered: 'date_delivered',
      archived: 'date_archived',
    };
    return map[status];
  }

  /**
   * Record status change in history
   */
  private recordStatusChange(
    weddingId: string,
    fromStatus: WeddingStatus | null,
    toStatus: WeddingStatus,
    notes?: string
  ): void {
    const db = getDatabase();
    const id = randomUUID();
    db.prepare(`
      INSERT INTO wedding_status_history (id, wedding_id, from_status, to_status, notes)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, weddingId, fromStatus, toStatus, notes ?? null);
  }

  /**
   * Get status history for a wedding
   */
  getStatusHistory(weddingId: string): WeddingStatusHistory[] {
    const db = getDatabase();
    return db.prepare(`
      SELECT * FROM wedding_status_history
      WHERE wedding_id = ?
      ORDER BY changed_at DESC
    `).all(weddingId) as WeddingStatusHistory[];
  }

  /**
   * Delete wedding
   */
  delete(id: string): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM weddings WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Get status counts
   */
  getStatusCounts(): Record<WeddingStatus, number> {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT status, COUNT(*) as count FROM weddings GROUP BY status
    `).all() as Array<{ status: WeddingStatus; count: number }>;

    const counts: Record<WeddingStatus, number> = {
      imported: 0,
      culling: 0,
      editing: 0,
      delivered: 0,
      archived: 0,
    };

    for (const row of rows) {
      counts[row.status] = row.count;
    }

    return counts;
  }

  /**
   * Get count of weddings delivered this month
   */
  getDeliveredThisMonth(): number {
    const db = getDatabase();
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

    const row = db.prepare(`
      SELECT COUNT(*) as count FROM weddings
      WHERE date_delivered >= ? AND date_delivered <= ?
    `).get(startOfMonth, endOfMonth) as { count: number };

    return row.count;
  }

  /**
   * Get upcoming deliveries (weddings in editing status, sorted by wedding date)
   */
  getUpcomingDeliveries(limit = 5): Array<{ wedding: Wedding; daysUntilDue: number; progress: number }> {
    const db = getDatabase();
    const weddings = db.prepare(`
      SELECT * FROM weddings
      WHERE status IN ('culling', 'editing')
      ORDER BY wedding_date ASC
      LIMIT ?
    `).all(limit) as Wedding[];

    return weddings.map((wedding) => {
      const weddingDate = new Date(wedding.wedding_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const daysUntilDue = Math.ceil((weddingDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      return {
        wedding,
        daysUntilDue,
        progress: this.calculateProgress(wedding),
      };
    });
  }

  /**
   * Get recent activity (status changes)
   */
  getRecentActivity(limit = 10): Array<{ wedding: Wedding; action: string; timestamp: string }> {
    const db = getDatabase();
    const history = db.prepare(`
      SELECT h.*, w.display_name
      FROM wedding_status_history h
      JOIN weddings w ON h.wedding_id = w.id
      ORDER BY h.changed_at DESC
      LIMIT ?
    `).all(limit) as Array<WeddingStatusHistory & { display_name: string }>;

    return history
      .map((h) => {
        const wedding = this.findById(h.wedding_id);
        if (!wedding) return null;

        let action = `Status changed to ${h.to_status}`;
        if (h.from_status) {
          action = `Moved from ${h.from_status} to ${h.to_status}`;
        }

        return {
          wedding,
          action,
          timestamp: h.changed_at,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }

  /**
   * Get dashboard statistics
   */
  getDashboardStats(): DashboardStats {
    return {
      byStatus: this.getStatusCounts(),
      deliveredThisMonth: this.getDeliveredThisMonth(),
      upcomingDeliveries: this.getUpcomingDeliveries(),
      recentActivity: this.getRecentActivity(),
    };
  }

  /**
   * Get monthly statistics
   */
  getMonthlyStats(year: number, month: number): MonthlyStats {
    const db = getDatabase();
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = new Date(year, month, 0).toISOString().split('T')[0];

    const weddingsShot = db.prepare(`
      SELECT COUNT(*) as count FROM weddings
      WHERE wedding_date >= ? AND wedding_date <= ?
    `).get(startDate, endDate) as { count: number };

    const weddingsDelivered = db.prepare(`
      SELECT COUNT(*) as count FROM weddings
      WHERE date_delivered >= ? AND date_delivered <= ?
    `).get(startDate, endDate) as { count: number };

    const inProgress = db.prepare(`
      SELECT COUNT(*) as count FROM weddings
      WHERE status IN ('culling', 'editing')
      AND wedding_date >= ? AND wedding_date <= ?
    `).get(startDate, endDate) as { count: number };

    const imagesEdited = db.prepare(`
      SELECT SUM(edited_images) as total FROM weddings
      WHERE date_editing_started >= ? AND date_editing_started <= ?
    `).get(startDate, endDate) as { total: number | null };

    return {
      weddingsShot: weddingsShot.count,
      weddingsDelivered: weddingsDelivered.count,
      inProgress: inProgress.count,
      imagesEdited: imagesEdited.total || 0,
    };
  }

  /**
   * Get yearly statistics
   */
  getYearlyStats(year: number): YearlyStats {
    const db = getDatabase();
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    const total = db.prepare(`
      SELECT COUNT(*) as count FROM weddings
      WHERE wedding_date >= ? AND wedding_date <= ?
    `).get(startDate, endDate) as { count: number };

    const delivered = db.prepare(`
      SELECT COUNT(*) as count FROM weddings
      WHERE date_delivered IS NOT NULL
      AND wedding_date >= ? AND wedding_date <= ?
    `).get(startDate, endDate) as { count: number };

    const avgDays = db.prepare(`
      SELECT AVG(
        JULIANDAY(date_delivered) - JULIANDAY(wedding_date)
      ) as avg_days FROM weddings
      WHERE date_delivered IS NOT NULL
      AND wedding_date >= ? AND wedding_date <= ?
    `).get(startDate, endDate) as { avg_days: number | null };

    return {
      totalWeddings: total.count,
      totalDelivered: delivered.count,
      deliveryRate: total.count > 0 ? Math.round((delivered.count / total.count) * 100) : 0,
      avgDaysToDelivery: Math.round(avgDays.avg_days || 0),
    };
  }

  /**
   * Get weddings for a specific month (for calendar view)
   */
  getWeddingsForMonth(year: number, month: number): Wedding[] {
    const db = getDatabase();
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = new Date(year, month, 0).toISOString().split('T')[0];

    return db.prepare(`
      SELECT * FROM weddings
      WHERE wedding_date >= ? AND wedding_date <= ?
      ORDER BY wedding_date ASC
    `).all(startDate, endDate) as Wedding[];
  }
}

export const weddingsRepository = new WeddingsRepository();
