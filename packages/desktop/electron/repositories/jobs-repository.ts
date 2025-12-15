/**
 * Jobs Repository
 *
 * Background job queue for processing tasks.
 */

import { getDatabase } from '../main/database';
import type { Job, JobStatus } from '@nightfox/core';

export interface JobCreateInput {
  job_type: string;
  payload_json: string;
  file_id?: number | null;
  couple_id?: number | null;
  priority?: number;
  depends_on_job_id?: number | null;
  max_retries?: number;
}

export class JobsRepository {
  /**
   * Find job by ID
   */
  findById(id: number): Job | null {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Job | undefined;
    return row ?? null;
  }

  /**
   * Find all pending jobs (ordered by priority)
   */
  findPending(limit?: number): Job[] {
    const db = getDatabase();
    let sql = `
      SELECT * FROM jobs
      WHERE status = 'pending'
      AND (depends_on_job_id IS NULL OR depends_on_job_id IN (
        SELECT id FROM jobs WHERE status = 'complete'
      ))
      ORDER BY priority DESC, created_at ASC
    `;

    if (limit) {
      sql += ` LIMIT ${limit}`;
    }

    return db.prepare(sql).all() as Job[];
  }

  /**
   * Find jobs by status
   */
  findByStatus(status: JobStatus): Job[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC')
      .all(status) as Job[];
  }

  /**
   * Find jobs by type
   */
  findByType(jobType: string): Job[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM jobs WHERE job_type = ? ORDER BY created_at DESC')
      .all(jobType) as Job[];
  }

  /**
   * Find jobs by file
   */
  findByFile(fileId: number): Job[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM jobs WHERE file_id = ? ORDER BY created_at DESC')
      .all(fileId) as Job[];
  }

  /**
   * Create a new job
   */
  create(input: JobCreateInput): Job {
    const db = getDatabase();
    const result = db
      .prepare(
        `INSERT INTO jobs (
          job_type, payload_json, file_id, couple_id, priority, depends_on_job_id, max_retries
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.job_type,
        input.payload_json,
        input.file_id ?? null,
        input.couple_id ?? null,
        input.priority ?? 0,
        input.depends_on_job_id ?? null,
        input.max_retries ?? 3
      );

    return this.findById(result.lastInsertRowid as number)!;
  }

  /**
   * Claim a job for processing (atomically update status)
   */
  claim(id: number): Job | null {
    const db = getDatabase();

    // Attempt to claim the job atomically
    const result = db
      .prepare(
        `UPDATE jobs SET status = 'processing', started_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'pending'`
      )
      .run(id);

    if (result.changes === 0) {
      return null; // Job was already claimed or doesn't exist
    }

    return this.findById(id);
  }

  /**
   * Mark job as complete
   */
  complete(id: number, processingTimeMs?: number): boolean {
    const db = getDatabase();
    const result = db
      .prepare(
        `UPDATE jobs SET
          status = 'complete',
          completed_at = CURRENT_TIMESTAMP,
          processing_time_ms = ?
         WHERE id = ?`
      )
      .run(processingTimeMs ?? null, id);
    return result.changes > 0;
  }

  /**
   * Mark job as failed
   */
  fail(id: number, errorMessage: string): boolean {
    const db = getDatabase();

    // Get current retry count
    const job = this.findById(id);
    if (!job) return false;

    const newRetryCount = job.retry_count + 1;
    const newStatus: JobStatus = newRetryCount >= job.max_retries ? 'dead' : 'pending';

    const result = db
      .prepare(
        `UPDATE jobs SET
          status = ?,
          error_message = ?,
          retry_count = ?,
          started_at = NULL,
          completed_at = CASE WHEN ? = 'dead' THEN CURRENT_TIMESTAMP ELSE NULL END
         WHERE id = ?`
      )
      .run(newStatus, errorMessage, newRetryCount, newStatus, id);

    return result.changes > 0;
  }

  /**
   * Cancel a job
   */
  cancel(id: number): boolean {
    const db = getDatabase();
    const result = db
      .prepare(
        `UPDATE jobs SET status = 'error', error_message = 'Cancelled by user'
         WHERE id = ? AND status IN ('pending', 'processing')`
      )
      .run(id);
    return result.changes > 0;
  }

  /**
   * Delete a job
   */
  delete(id: number): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Delete completed jobs older than specified days
   */
  deleteOldCompleted(daysOld: number): number {
    const db = getDatabase();
    const result = db
      .prepare(
        `DELETE FROM jobs
         WHERE status = 'complete'
         AND datetime(completed_at) < datetime('now', '-' || ? || ' days')`
      )
      .run(daysOld);
    return result.changes;
  }

  /**
   * Get job statistics
   */
  getStats(): {
    pending: number;
    processing: number;
    complete: number;
    error: number;
    dead: number;
  } {
    const db = getDatabase();
    const rows = db
      .prepare(
        `SELECT status, COUNT(*) as count
         FROM jobs
         GROUP BY status`
      )
      .all() as Array<{ status: JobStatus; count: number }>;

    const stats = {
      pending: 0,
      processing: 0,
      complete: 0,
      error: 0,
      dead: 0,
    };

    for (const row of rows) {
      stats[row.status] = row.count;
    }

    return stats;
  }

  /**
   * Get next available job for processing
   */
  getNext(): Job | null {
    const pending = this.findPending(1);
    if (pending.length === 0) return null;

    return this.claim(pending[0].id);
  }

  /**
   * Retry a dead job
   */
  retry(id: number): boolean {
    const db = getDatabase();
    const result = db
      .prepare(
        `UPDATE jobs SET
          status = 'pending',
          error_message = NULL,
          retry_count = 0,
          started_at = NULL,
          completed_at = NULL
         WHERE id = ? AND status = 'dead'`
      )
      .run(id);
    return result.changes > 0;
  }

  /**
   * Find dead jobs
   */
  findDead(): Job[] {
    const db = getDatabase();
    return db
      .prepare('SELECT * FROM jobs WHERE status = \'dead\' ORDER BY completed_at DESC')
      .all() as Job[];
  }
}

export const jobsRepository = new JobsRepository();
