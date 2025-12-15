/**
 * Extraction Queue Service
 *
 * Background worker that processes the extraction_queue table.
 * Triggered when web sources are saved, processes dates, entities, titles, summaries.
 *
 * Per extraction-pipeline-final.md:
 * - LLM does exactly 4 tasks: dates, entities, title, summary
 * - Runs in background only - no user interaction
 * - Auto-approve high confidence (>0.85), queue low confidence for review
 *
 * @version 1.0
 */

import type { Database as SqliteDatabase } from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { ExtractionService } from './extraction-service';
import type { ExtractionResult, ExtractedDate, ExtractedPerson, ExtractedOrganization } from './extraction-types';

// =============================================================================
// TYPES
// =============================================================================

export interface QueueJob {
  queue_id: string;
  source_type: 'web_source' | 'document' | 'media';
  source_id: string;
  locid: string | null;
  tasks: string[];
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'partial';
  priority: number;
  attempts: number;
  max_attempts: number;
  results_json: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface ExtractionQueueConfig {
  pollIntervalMs: number;
  maxConcurrency: number;
  autoApproveThreshold: number;
  reviewThreshold: number;
  rejectThreshold: number;
}

const DEFAULT_CONFIG: ExtractionQueueConfig = {
  pollIntervalMs: 5000,         // Poll every 5 seconds
  maxConcurrency: 2,            // Max 2 concurrent extractions
  autoApproveThreshold: 0.85,   // Auto-approve if confidence > 0.85
  reviewThreshold: 0.5,         // Needs review if confidence 0.5-0.85
  rejectThreshold: 0.5,         // Auto-reject if confidence < 0.5
};

// =============================================================================
// EXTRACTION QUEUE SERVICE
// =============================================================================

export class ExtractionQueueService {
  private db: SqliteDatabase;
  private extractionService: ExtractionService;
  private config: ExtractionQueueConfig;
  private isRunning = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private activeJobs = 0;

  constructor(db: SqliteDatabase, config?: Partial<ExtractionQueueConfig>) {
    this.db = db;
    this.extractionService = new ExtractionService(db);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start the queue processing loop
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[ExtractionQueue] Already running');
      return;
    }

    await this.extractionService.initialize();
    this.isRunning = true;
    console.log('[ExtractionQueue] Started background processing');

    this.poll();
  }

  /**
   * Stop the queue processing
   */
  stop(): void {
    this.isRunning = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    console.log('[ExtractionQueue] Stopped');
  }

  /**
   * Add a job to the extraction queue
   */
  async enqueue(
    sourceType: 'web_source' | 'document' | 'media',
    sourceId: string,
    locid: string | null,
    tasks: string[] = ['dates', 'entities', 'title', 'summary'],
    priority: number = 0
  ): Promise<string> {
    const queueId = randomUUID().replace(/-/g, '').slice(0, 16);

    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO extraction_queue
        (queue_id, source_type, source_id, locid, tasks, status, priority, attempts, max_attempts, created_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?, 0, 3, datetime('now'))
      `).run(queueId, sourceType, sourceId, locid, JSON.stringify(tasks), priority);

      console.log(`[ExtractionQueue] Enqueued job ${queueId} for ${sourceType}:${sourceId}`);
      return queueId;
    } catch (error) {
      // Handle duplicate - job already exists
      if (String(error).includes('UNIQUE constraint')) {
        console.log(`[ExtractionQueue] Job already exists for ${sourceType}:${sourceId}`);
        const existing = this.db.prepare(`
          SELECT queue_id FROM extraction_queue WHERE source_type = ? AND source_id = ?
        `).get(sourceType, sourceId) as { queue_id: string } | undefined;
        return existing?.queue_id || queueId;
      }
      throw error;
    }
  }

  /**
   * Poll for pending jobs and process them
   */
  private async poll(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // Get pending jobs
      while (this.activeJobs < this.config.maxConcurrency) {
        const job = this.getNextJob();
        if (!job) break;

        this.activeJobs++;
        this.processJob(job)
          .catch((error) => {
            console.error(`[ExtractionQueue] Job ${job.queue_id} failed:`, error);
          })
          .finally(() => {
            this.activeJobs--;
          });
      }
    } catch (error) {
      console.error('[ExtractionQueue] Poll error:', error);
    }

    // Schedule next poll
    this.pollTimer = setTimeout(() => this.poll(), this.config.pollIntervalMs);
  }

  /**
   * Get next pending job and lock it
   */
  private getNextJob(): QueueJob | null {
    const job = this.db.prepare(`
      SELECT * FROM extraction_queue
      WHERE status = 'pending'
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    `).get() as QueueJob | undefined;

    if (!job) return null;

    // Lock the job
    this.db.prepare(`
      UPDATE extraction_queue
      SET status = 'processing', started_at = datetime('now'), attempts = attempts + 1
      WHERE queue_id = ?
    `).run(job.queue_id);

    return { ...job, status: 'processing', tasks: JSON.parse(job.tasks as unknown as string) };
  }

  /**
   * Process a single extraction job
   */
  private async processJob(job: QueueJob): Promise<void> {
    console.log(`[ExtractionQueue] Processing job ${job.queue_id} (${job.source_type}:${job.source_id})`);

    try {
      // Get source text based on type
      const text = await this.getSourceText(job);
      if (!text || text.length < 10) {
        throw new Error('No text content to extract from');
      }

      // Run extraction
      const result = await this.extractionService.extract(
        {
          text,
          sourceType: job.source_type,
          sourceId: job.source_id,
          extractTypes: ['dates', 'people', 'organizations', 'summary', 'title'],
        },
        {
          needsSummary: job.tasks.includes('summary'),
          needsTitle: job.tasks.includes('title'),
          agents: ['date_extraction', 'summary_title'],
        }
      );

      // Store results
      await this.storeResults(job, result);

      // Mark complete
      this.db.prepare(`
        UPDATE extraction_queue
        SET status = 'completed', completed_at = datetime('now'), results_json = ?
        WHERE queue_id = ?
      `).run(JSON.stringify(result), job.queue_id);

      console.log(`[ExtractionQueue] Job ${job.queue_id} completed`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check if should retry
      if (job.attempts < job.max_attempts) {
        this.db.prepare(`
          UPDATE extraction_queue
          SET status = 'pending', error_message = ?
          WHERE queue_id = ?
        `).run(errorMessage, job.queue_id);
        console.log(`[ExtractionQueue] Job ${job.queue_id} will retry (attempt ${job.attempts}/${job.max_attempts})`);
      } else {
        this.db.prepare(`
          UPDATE extraction_queue
          SET status = 'failed', completed_at = datetime('now'), error_message = ?
          WHERE queue_id = ?
        `).run(errorMessage, job.queue_id);
        console.error(`[ExtractionQueue] Job ${job.queue_id} failed permanently: ${errorMessage}`);
      }
    }
  }

  /**
   * Get text content from source
   */
  private async getSourceText(job: QueueJob): Promise<string | null> {
    if (job.source_type === 'web_source') {
      const source = this.db.prepare(`
        SELECT extracted_text, title, extracted_title FROM web_sources WHERE source_id = ?
      `).get(job.source_id) as { extracted_text: string | null; title: string | null; extracted_title: string | null } | undefined;

      if (!source) return null;
      return source.extracted_text || source.extracted_title || source.title || '';
    }

    // Future: handle documents, media captions
    return null;
  }

  /**
   * Store extraction results in appropriate tables
   */
  private async storeResults(job: QueueJob, result: ExtractionResult & { providerId: string }): Promise<void> {
    const { providerId } = result;

    // 1. Update web_sources with smart title and summary
    if (job.source_type === 'web_source') {
      const smartTitle = result.summaryData?.title || result.title || null;
      const smartSummary = result.summaryData?.summary || result.summary || null;
      const overallConfidence = this.calculateOverallConfidence(result);

      this.db.prepare(`
        UPDATE web_sources SET
          smart_title = ?,
          smart_summary = ?,
          extraction_status = 'completed',
          extraction_confidence = ?,
          extraction_provider = ?,
          extraction_model = ?,
          extraction_completed_at = datetime('now')
        WHERE source_id = ?
      `).run(
        smartTitle?.slice(0, 60),  // Max 60 chars per spec
        smartSummary,
        overallConfidence,
        providerId,
        result.model || null,
        job.source_id
      );

      // 1b. Also update timeline event for this web source with smart_title/tldr
      if (smartTitle || smartSummary) {
        this.db.prepare(`
          UPDATE location_timeline SET
            smart_title = ?,
            tldr = ?,
            confidence = ?,
            needs_review = ?
          WHERE source_ref = ? AND event_type = 'custom' AND event_subtype = 'web_page'
        `).run(
          smartTitle?.slice(0, 60),
          smartSummary,
          overallConfidence,
          overallConfidence < 0.85 ? 1 : 0,
          job.source_id
        );
      }
    }

    // 2. Store entities (people and organizations)
    await this.storeEntities(job, result.people, result.organizations, providerId);

    // 3. Create timeline events from high-confidence dates
    await this.createTimelineEvents(job, result.dates, providerId);
  }

  /**
   * Store extracted entities
   */
  private async storeEntities(
    job: QueueJob,
    people: ExtractedPerson[],
    organizations: ExtractedOrganization[],
    providerId: string
  ): Promise<void> {
    const insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO entity_extractions
      (extraction_id, source_type, source_id, locid, entity_type, raw_text, entity_name, entity_role,
       date_range, confidence, overall_confidence, provider_id, context_sentence, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    // Store people
    for (const person of people) {
      if (person.confidence < this.config.rejectThreshold) continue;

      const extractionId = randomUUID().replace(/-/g, '').slice(0, 16);
      const status = person.confidence >= this.config.autoApproveThreshold ? 'approved' : 'pending';

      insertStmt.run(
        extractionId,
        job.source_type,
        job.source_id,
        job.locid,
        'person',
        person.name,  // raw_text (NOT NULL) - use name as raw text
        person.name,  // entity_name
        person.role || null,
        null, // date_range - would need to be extracted from context
        person.confidence,
        person.confidence, // overall_confidence
        providerId,
        null, // context_sentence
        status
      );
    }

    // Store organizations
    for (const org of organizations) {
      if (org.confidence < this.config.rejectThreshold) continue;

      const extractionId = randomUUID().replace(/-/g, '').slice(0, 16);
      const status = org.confidence >= this.config.autoApproveThreshold ? 'approved' : 'pending';

      insertStmt.run(
        extractionId,
        job.source_type,
        job.source_id,
        job.locid,
        'organization',
        org.name,  // raw_text (NOT NULL)
        org.name,  // entity_name
        org.type || null,
        null,
        org.confidence,
        org.confidence, // overall_confidence
        providerId,
        null,
        status
      );
    }
  }

  /**
   * Create timeline events from extracted dates
   */
  private async createTimelineEvents(
    job: QueueJob,
    dates: ExtractedDate[],
    providerId: string
  ): Promise<void> {
    if (!job.locid) return; // Need location to create timeline events

    const insertStmt = this.db.prepare(`
      INSERT INTO location_timeline
      (event_id, locid, event_type, event_subtype, date_start, date_precision, date_display,
       date_sort, source_type, source_ref, auto_approved, confidence, needs_review, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    for (const date of dates) {
      // Skip low confidence dates
      if (date.confidence < this.config.reviewThreshold) continue;

      const eventId = randomUUID().replace(/-/g, '').slice(0, 16);
      const autoApproved = date.confidence >= this.config.autoApproveThreshold ? 1 : 0;
      const needsReview = date.confidence < this.config.autoApproveThreshold ? 1 : 0;

      // Map category to event type
      const eventType = this.mapCategoryToEventType(date.category);
      const eventSubtype = this.mapCategoryToEventSubtype(date.category);

      // Calculate date_sort from parsed date
      const dateSort = this.calculateDateSort(date.parsedDate);

      try {
        insertStmt.run(
          eventId,
          job.locid,
          eventType,
          eventSubtype,
          date.parsedDate || null,
          date.precision || 'unknown',
          date.rawText,
          dateSort,
          'extraction',
          job.source_id,
          autoApproved,
          date.confidence,
          needsReview
        );
      } catch (error) {
        // Log but don't fail - might be duplicate
        console.warn(`[ExtractionQueue] Failed to create timeline event: ${error}`);
      }
    }
  }

  /**
   * Calculate overall confidence from result
   */
  private calculateOverallConfidence(result: ExtractionResult): number {
    const scores: number[] = [];

    // Average date confidence
    if (result.dates.length > 0) {
      const avgDate = result.dates.reduce((sum, d) => sum + d.confidence, 0) / result.dates.length;
      scores.push(avgDate);
    }

    // Average people confidence
    if (result.people.length > 0) {
      const avgPeople = result.people.reduce((sum, p) => sum + p.confidence, 0) / result.people.length;
      scores.push(avgPeople);
    }

    // Average org confidence
    if (result.organizations.length > 0) {
      const avgOrg = result.organizations.reduce((sum, o) => sum + o.confidence, 0) / result.organizations.length;
      scores.push(avgOrg);
    }

    // Summary confidence (high if generated)
    if (result.summaryData?.summary || result.summary) {
      scores.push(0.8);
    }

    return scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  }

  /**
   * Map date category to timeline event type
   */
  private mapCategoryToEventType(category: string): string {
    switch (category) {
      case 'build_date':
      case 'opening':
      case 'established':
        return 'established';
      case 'site_visit':
        return 'visit';
      case 'closure':
      case 'demolition':
        return 'established'; // Use established with subtype
      default:
        return 'custom';
    }
  }

  /**
   * Map date category to event subtype
   */
  private mapCategoryToEventSubtype(category: string): string | null {
    switch (category) {
      case 'build_date':
        return 'built';
      case 'opening':
        return 'opened';
      case 'closure':
        return 'closed';
      case 'demolition':
        return 'demolished';
      case 'established':
        return 'established';
      default:
        return null;
    }
  }

  /**
   * Calculate sort key from parsed date string
   */
  private calculateDateSort(parsedDate: string | null): number | null {
    if (!parsedDate) return null;

    // Extract year from various formats: "2023", "2023-04", "2023-04-28"
    const match = parsedDate.match(/^(\d{4})/);
    if (!match) return null;

    const year = parseInt(match[1], 10);
    let sortKey = year * 10000;

    // Add month if present
    const monthMatch = parsedDate.match(/^\d{4}-(\d{2})/);
    if (monthMatch) {
      sortKey += parseInt(monthMatch[1], 10) * 100;
    }

    // Add day if present
    const dayMatch = parsedDate.match(/^\d{4}-\d{2}-(\d{2})/);
    if (dayMatch) {
      sortKey += parseInt(dayMatch[1], 10);
    }

    return sortKey;
  }

  /**
   * Get queue status
   */
  getStatus(): {
    running: boolean;
    activeJobs: number;
    pending: number;
    completed: number;
    failed: number;
  } {
    const stats = this.db.prepare(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed
      FROM extraction_queue
    `).get() as { pending: number; completed: number; failed: number };

    return {
      running: this.isRunning,
      activeJobs: this.activeJobs,
      ...stats,
    };
  }

  /**
   * Clear completed/failed jobs older than specified days
   */
  cleanup(olderThanDays: number = 7): number {
    const result = this.db.prepare(`
      DELETE FROM extraction_queue
      WHERE status IN ('completed', 'failed')
      AND completed_at < datetime('now', '-' || ? || ' days')
    `).run(olderThanDays);

    console.log(`[ExtractionQueue] Cleaned up ${result.changes} old jobs`);
    return result.changes;
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let queueServiceInstance: ExtractionQueueService | null = null;

export function getExtractionQueueService(db: SqliteDatabase): ExtractionQueueService {
  if (!queueServiceInstance) {
    queueServiceInstance = new ExtractionQueueService(db);
  }
  return queueServiceInstance;
}

export function shutdownExtractionQueueService(): void {
  if (queueServiceInstance) {
    queueServiceInstance.stop();
    queueServiceInstance = null;
  }
}
