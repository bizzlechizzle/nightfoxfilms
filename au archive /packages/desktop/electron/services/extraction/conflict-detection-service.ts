/**
 * Conflict Detection Service
 *
 * Detects and manages fact conflicts between multiple sources.
 * Tracks when sources provide contradictory information and
 * facilitates resolution.
 *
 * @version 1.0
 */

import type { Database as SqliteDatabase } from 'better-sqlite3';
import { randomUUID } from 'crypto';

import type {
  FactConflict,
  FactConflictInput,
  ConflictClaim,
  ConflictType,
  ConflictResolution,
  ConflictResolutionInput,
  ConflictDetectionResult,
  ConflictDetectionOptions,
  ConflictSummary,
  SourceAuthority,
  ConflictResolutionSuggestion,
  FactConflictWithSuggestion,
} from './conflict-types';

import { DEFAULT_CONFLICT_OPTIONS, getDefaultTier } from './conflict-types';

// =============================================================================
// OLLAMA HELPER (for LLM-based conflict resolution)
// =============================================================================

interface OllamaGenerateOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Simple Ollama generate call for conflict resolution
 * Uses default localhost:11434 endpoint
 */
async function ollamaGenerate(
  prompt: string,
  options: OllamaGenerateOptions = {}
): Promise<string | null> {
  const {
    model = 'qwen2.5:32b',
    temperature = 0.3,
    maxTokens = 500,
  } = options;

  try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature,
          num_predict: maxTokens,
        },
      }),
    });

    if (!response.ok) {
      console.warn(`[ConflictDetection] Ollama returned ${response.status}`);
      return null;
    }

    const data = await response.json() as { response?: string };
    return data.response || null;
  } catch (error) {
    console.warn('[ConflictDetection] Ollama call failed:', error);
    return null;
  }
}

// =============================================================================
// TYPES
// =============================================================================

/**
 * Extracted date with source information
 */
interface SourcedDate {
  parsedDate: string | null;
  category: string;
  confidence: number;
  context: string;
  sourceRef: string;
  sourceDomain?: string;
}

/**
 * Field value with source
 */
interface SourcedValue {
  value: string;
  confidence: number;
  context: string;
  sourceRef: string;
  sourceDomain?: string;
}

// =============================================================================
// CONFLICT DETECTION SERVICE
// =============================================================================

export class ConflictDetectionService {
  private db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  /**
   * Detect conflicts for a location based on timeline extractions
   *
   * @param locid - Location ID
   * @param options - Detection options
   * @returns Detection result with new and existing conflicts
   */
  async detectTimelineConflicts(
    locid: string,
    options?: ConflictDetectionOptions
  ): Promise<ConflictDetectionResult> {
    const config = { ...DEFAULT_CONFLICT_OPTIONS, ...options };

    // Get all timeline events for this location
    const events = this.db.prepare(`
      SELECT
        event_id,
        event_date,
        event_date_end,
        event_type,
        description,
        confidence,
        source_refs,
        verb_context
      FROM location_timeline
      WHERE locid = ?
      ORDER BY event_type, event_date
    `).all(locid) as Array<{
      event_id: string;
      event_date: string | null;
      event_date_end: string | null;
      event_type: string;
      description: string;
      confidence: number;
      source_refs: string | null;
      verb_context: string | null;
    }>;

    const newConflicts: FactConflict[] = [];
    const updatedConflicts: string[] = [];

    // Group events by type
    const eventsByType = new Map<string, typeof events>();
    for (const event of events) {
      const existing = eventsByType.get(event.event_type) || [];
      existing.push(event);
      eventsByType.set(event.event_type, existing);
    }

    // Check each event type for conflicts
    for (const [eventType, typeEvents] of eventsByType) {
      if (typeEvents.length < 2) continue;

      // Compare each pair of events
      for (let i = 0; i < typeEvents.length; i++) {
        for (let j = i + 1; j < typeEvents.length; j++) {
          const a = typeEvents[i];
          const b = typeEvents[j];

          // Check for date mismatch
          if (a.event_date && b.event_date && a.event_date !== b.event_date) {
            // Check if this conflict already exists
            const existing = this.findExistingConflict(
              locid,
              'date_mismatch',
              eventType,
              a.event_date,
              b.event_date
            );

            if (existing) {
              updatedConflicts.push(existing.conflict_id);
            } else {
              // Create new conflict
              const conflict = this.createConflict({
                locid,
                conflict_type: 'date_mismatch',
                field_name: eventType,
                claim_a: {
                  value: a.event_date,
                  source_ref: this.getFirstSourceRef(a.source_refs),
                  confidence: a.confidence,
                  context: a.description,
                  source_domain: this.getDomainFromSourceRef(this.getFirstSourceRef(a.source_refs)),
                },
                claim_b: {
                  value: b.event_date,
                  source_ref: this.getFirstSourceRef(b.source_refs),
                  confidence: b.confidence,
                  context: b.description,
                  source_domain: this.getDomainFromSourceRef(this.getFirstSourceRef(b.source_refs)),
                },
              });

              newConflicts.push(conflict);
            }
          }
        }
      }
    }

    // Get total and unresolved counts
    const counts = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN resolved = 0 THEN 1 ELSE 0 END) as unresolved
      FROM fact_conflicts
      WHERE locid = ?
    `).get(locid) as { total: number; unresolved: number };

    return {
      new_conflicts: newConflicts,
      updated_conflicts: updatedConflicts,
      total_conflicts: counts.total + newConflicts.length,
      unresolved_count: counts.unresolved + newConflicts.length,
    };
  }

  /**
   * Detect conflicts between two extraction results
   *
   * @param locid - Location ID
   * @param sourceA - First source extractions
   * @param sourceB - Second source extractions
   * @returns Detected conflicts
   */
  detectExtractionConflicts(
    locid: string,
    sourceA: { dates: SourcedDate[]; sourceRef: string },
    sourceB: { dates: SourcedDate[]; sourceRef: string }
  ): FactConflict[] {
    const conflicts: FactConflict[] = [];

    // Group dates by category
    const datesA = new Map<string, SourcedDate[]>();
    const datesB = new Map<string, SourcedDate[]>();

    for (const date of sourceA.dates) {
      const existing = datesA.get(date.category) || [];
      existing.push({ ...date, sourceRef: sourceA.sourceRef });
      datesA.set(date.category, existing);
    }

    for (const date of sourceB.dates) {
      const existing = datesB.get(date.category) || [];
      existing.push({ ...date, sourceRef: sourceB.sourceRef });
      datesB.set(date.category, existing);
    }

    // Compare categories
    for (const [category, aDates] of datesA) {
      const bDates = datesB.get(category);
      if (!bDates || bDates.length === 0) continue;

      // Compare each date from A with dates from B
      for (const dateA of aDates) {
        for (const dateB of bDates) {
          if (
            dateA.parsedDate &&
            dateB.parsedDate &&
            !this.areDatesCompatible(dateA.parsedDate, dateB.parsedDate)
          ) {
            // Conflict found
            const conflict = this.createConflict({
              locid,
              conflict_type: 'date_mismatch',
              field_name: category,
              claim_a: {
                value: dateA.parsedDate,
                source_ref: dateA.sourceRef,
                confidence: dateA.confidence,
                context: dateA.context,
                source_domain: dateA.sourceDomain,
              },
              claim_b: {
                value: dateB.parsedDate,
                source_ref: dateB.sourceRef,
                confidence: dateB.confidence,
                context: dateB.context,
                source_domain: dateB.sourceDomain,
              },
            });

            conflicts.push(conflict);
          }
        }
      }
    }

    return conflicts;
  }

  /**
   * Check if two dates are compatible (allowing for precision differences)
   */
  private areDatesCompatible(dateA: string, dateB: string): boolean {
    // Extract years
    const yearA = dateA.split('-')[0];
    const yearB = dateB.split('-')[0];

    // If years don't match, not compatible
    if (yearA !== yearB) return false;

    // If one has month and other doesn't, compatible
    const partsA = dateA.split('-');
    const partsB = dateB.split('-');

    if (partsA.length !== partsB.length) return true;

    // If same precision, must match exactly
    return dateA === dateB;
  }

  /**
   * Create and store a new conflict
   */
  createConflict(input: FactConflictInput): FactConflict {
    const conflict_id = randomUUID();
    const now = new Date().toISOString();

    // Get source authority tiers
    const tierA = this.getSourceTier(input.claim_a.source_domain);
    const tierB = this.getSourceTier(input.claim_b.source_domain);

    const conflict: FactConflict = {
      conflict_id,
      locid: input.locid,
      conflict_type: input.conflict_type,
      field_name: input.field_name,
      claim_a: {
        ...input.claim_a,
        source_tier: tierA,
      },
      claim_b: {
        ...input.claim_b,
        source_tier: tierB,
      },
      resolved: false,
      created_at: now,
    };

    // Insert into database
    this.db.prepare(`
      INSERT INTO fact_conflicts (
        conflict_id, locid, conflict_type, field_name,
        claim_a_value, claim_a_source, claim_a_confidence, claim_a_context,
        claim_b_value, claim_b_source, claim_b_confidence, claim_b_context,
        resolved, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      conflict.conflict_id,
      conflict.locid,
      conflict.conflict_type,
      conflict.field_name,
      conflict.claim_a.value,
      conflict.claim_a.source_ref,
      conflict.claim_a.confidence,
      conflict.claim_a.context || null,
      conflict.claim_b.value,
      conflict.claim_b.source_ref,
      conflict.claim_b.confidence,
      conflict.claim_b.context || null,
      0,
      conflict.created_at
    );

    return conflict;
  }

  /**
   * Resolve a conflict
   */
  resolveConflict(input: ConflictResolutionInput): FactConflict | null {
    const now = new Date().toISOString();

    const result = this.db.prepare(`
      UPDATE fact_conflicts SET
        resolved = 1,
        resolution = ?,
        resolution_notes = ?,
        resolved_by = ?,
        resolved_at = ?
      WHERE conflict_id = ?
    `).run(
      input.resolution,
      input.resolution_notes || null,
      input.resolved_by || null,
      now,
      input.conflict_id
    );

    if (result.changes === 0) {
      return null;
    }

    return this.getConflictById(input.conflict_id);
  }

  /**
   * Get a conflict by ID
   */
  getConflictById(conflict_id: string): FactConflict | null {
    const row = this.db.prepare(`
      SELECT * FROM fact_conflicts WHERE conflict_id = ?
    `).get(conflict_id) as Record<string, unknown> | undefined;

    if (!row) return null;

    return this.rowToConflict(row);
  }

  /**
   * Get all conflicts for a location
   */
  getConflictsForLocation(
    locid: string,
    includeResolved = false
  ): FactConflict[] {
    const query = includeResolved
      ? `SELECT * FROM fact_conflicts WHERE locid = ? ORDER BY created_at DESC`
      : `SELECT * FROM fact_conflicts WHERE locid = ? AND resolved = 0 ORDER BY created_at DESC`;

    const rows = this.db.prepare(query).all(locid) as Array<Record<string, unknown>>;

    return rows.map((row) => this.rowToConflict(row));
  }

  /**
   * Get conflict summary for a location
   */
  getConflictSummary(locid: string): ConflictSummary {
    // Get counts
    const counts = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN resolved = 0 THEN 1 ELSE 0 END) as unresolved
      FROM fact_conflicts
      WHERE locid = ?
    `).get(locid) as { total: number; unresolved: number };

    // Get counts by type
    const byType = this.db.prepare(`
      SELECT conflict_type, COUNT(*) as count
      FROM fact_conflicts
      WHERE locid = ?
      GROUP BY conflict_type
    `).all(locid) as Array<{ conflict_type: string; count: number }>;

    // Get counts by field
    const byField = this.db.prepare(`
      SELECT field_name, COUNT(*) as count
      FROM fact_conflicts
      WHERE locid = ?
      GROUP BY field_name
    `).all(locid) as Array<{ field_name: string; count: number }>;

    // Get most recent
    const mostRecent = this.db.prepare(`
      SELECT created_at FROM fact_conflicts
      WHERE locid = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(locid) as { created_at: string } | undefined;

    return {
      locid,
      total: counts.total,
      unresolved: counts.unresolved,
      by_type: byType.reduce(
        (acc, row) => {
          acc[row.conflict_type as ConflictType] = row.count;
          return acc;
        },
        {} as Record<ConflictType, number>
      ),
      by_field: byField.reduce(
        (acc, row) => {
          acc[row.field_name] = row.count;
          return acc;
        },
        {} as Record<string, number>
      ),
      most_recent: mostRecent?.created_at,
    };
  }

  /**
   * Find existing conflict
   */
  private findExistingConflict(
    locid: string,
    conflictType: ConflictType,
    fieldName: string,
    valueA: string,
    valueB: string
  ): FactConflict | null {
    const row = this.db.prepare(`
      SELECT * FROM fact_conflicts
      WHERE locid = ?
        AND conflict_type = ?
        AND field_name = ?
        AND ((claim_a_value = ? AND claim_b_value = ?)
          OR (claim_a_value = ? AND claim_b_value = ?))
      LIMIT 1
    `).get(locid, conflictType, fieldName, valueA, valueB, valueB, valueA) as
      | Record<string, unknown>
      | undefined;

    if (!row) return null;

    return this.rowToConflict(row);
  }

  /**
   * Get source authority tier
   */
  private getSourceTier(domain: string | undefined): number {
    if (!domain) return 3;

    // Check database first
    const row = this.db.prepare(`
      SELECT tier FROM source_authority WHERE domain = ?
    `).get(domain) as { tier: number } | undefined;

    if (row) return row.tier;

    // Fall back to default tier calculation
    return getDefaultTier(domain);
  }

  /**
   * Get first source ref from JSON array
   */
  private getFirstSourceRef(sourceRefs: string | null): string {
    if (!sourceRefs) return 'unknown';

    try {
      const refs = JSON.parse(sourceRefs) as string[];
      return refs[0] || 'unknown';
    } catch {
      return sourceRefs;
    }
  }

  /**
   * Get domain from source ref (web_source ID)
   */
  private getDomainFromSourceRef(sourceRef: string): string | undefined {
    try {
      const row = this.db.prepare(`
        SELECT url FROM web_sources WHERE source_id = ?
      `).get(sourceRef) as { url: string } | undefined;

      if (!row?.url) return undefined;

      const url = new URL(row.url);
      return url.hostname;
    } catch {
      return undefined;
    }
  }

  /**
   * Convert database row to FactConflict
   */
  private rowToConflict(row: Record<string, unknown>): FactConflict {
    return {
      conflict_id: row.conflict_id as string,
      locid: row.locid as string,
      conflict_type: row.conflict_type as ConflictType,
      field_name: row.field_name as string,
      claim_a: {
        value: row.claim_a_value as string,
        source_ref: row.claim_a_source as string,
        confidence: row.claim_a_confidence as number,
        context: row.claim_a_context as string | undefined,
      },
      claim_b: {
        value: row.claim_b_value as string,
        source_ref: row.claim_b_source as string,
        confidence: row.claim_b_confidence as number,
        context: row.claim_b_context as string | undefined,
      },
      resolved: Boolean(row.resolved),
      resolution: row.resolution as ConflictResolution | undefined,
      resolution_notes: row.resolution_notes as string | undefined,
      resolved_by: row.resolved_by as string | undefined,
      resolved_at: row.resolved_at as string | undefined,
      created_at: row.created_at as string,
    };
  }

  /**
   * Add or update source authority
   */
  setSourceAuthority(
    domain: string,
    tier: 1 | 2 | 3 | 4,
    notes?: string
  ): SourceAuthority {
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO source_authority (domain, tier, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(domain) DO UPDATE SET
        tier = excluded.tier,
        notes = excluded.notes,
        updated_at = excluded.updated_at
    `).run(domain, tier, notes || null, now, now);

    return {
      domain,
      tier,
      notes,
      updated_at: now,
    };
  }

  /**
   * Get all source authorities
   */
  getAllSourceAuthorities(): SourceAuthority[] {
    const rows = this.db.prepare(`
      SELECT * FROM source_authority ORDER BY tier ASC, domain ASC
    `).all() as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      domain: row.domain as string,
      tier: row.tier as 1 | 2 | 3 | 4,
      notes: row.notes as string | undefined,
      created_at: row.created_at as string | undefined,
      updated_at: row.updated_at as string | undefined,
    }));
  }

  /**
   * Suggest resolution based on source authority (rule-based)
   * Per LLM Tools Overhaul: First strategy in three-strategy approach
   */
  suggestResolution(conflict: FactConflict): ConflictResolutionSuggestion {
    const tierA = conflict.claim_a.source_tier || 3;
    const tierB = conflict.claim_b.source_tier || 3;

    // Higher tier (lower number) is more authoritative
    if (tierA < tierB) {
      return {
        suggestedResolution: 'claim_a',
        reasoning: `Source A has higher authority (tier ${tierA} vs ${tierB})`,
        confidence: 0.7 + (tierB - tierA) * 0.1,
        strategy: 'source_authority',
      };
    }

    if (tierB < tierA) {
      return {
        suggestedResolution: 'claim_b',
        reasoning: `Source B has higher authority (tier ${tierB} vs ${tierA})`,
        confidence: 0.7 + (tierA - tierB) * 0.1,
        strategy: 'source_authority',
      };
    }

    // Same tier - use confidence
    if (conflict.claim_a.confidence > conflict.claim_b.confidence + 0.1) {
      return {
        suggestedResolution: 'claim_a',
        reasoning: `Source A has higher extraction confidence (${conflict.claim_a.confidence.toFixed(2)} vs ${conflict.claim_b.confidence.toFixed(2)})`,
        confidence: 0.6,
        strategy: 'confidence_based',
      };
    }

    if (conflict.claim_b.confidence > conflict.claim_a.confidence + 0.1) {
      return {
        suggestedResolution: 'claim_b',
        reasoning: `Source B has higher extraction confidence (${conflict.claim_b.confidence.toFixed(2)} vs ${conflict.claim_a.confidence.toFixed(2)})`,
        confidence: 0.6,
        strategy: 'confidence_based',
      };
    }

    // Can't determine - needs review
    return {
      suggestedResolution: 'needs_review',
      reasoning: 'Sources have similar authority and confidence - manual review recommended',
      confidence: 0.3,
      strategy: 'manual_required',
      reviewNotes: `Claim A: "${conflict.claim_a.value}" (tier ${tierA}, conf ${conflict.claim_a.confidence.toFixed(2)})\nClaim B: "${conflict.claim_b.value}" (tier ${tierB}, conf ${conflict.claim_b.confidence.toFixed(2)})`,
    };
  }

  /**
   * Suggest resolution using LLM analysis (async)
   * Per LLM Tools Overhaul: Second strategy - LLM picks best
   *
   * @param conflict - The conflict to analyze
   * @returns Resolution suggestion with LLM reasoning
   */
  async suggestLLMResolution(conflict: FactConflict): Promise<ConflictResolutionSuggestion> {
    // First try rule-based resolution
    const ruleBasedSuggestion = this.suggestResolution(conflict);

    // If rule-based has high confidence, use it
    if (ruleBasedSuggestion.confidence >= 0.7) {
      return ruleBasedSuggestion;
    }

    // Try LLM-based resolution
    try {
      const prompt = `You are an archive historian resolving a fact conflict between two sources.

CONFLICT TYPE: ${conflict.conflict_type}
FIELD: ${conflict.field_name}

CLAIM A:
- Value: ${conflict.claim_a.value}
- Source: ${conflict.claim_a.source_domain || 'unknown'}
- Authority Tier: ${conflict.claim_a.source_tier || 3} (1=highest, 4=lowest)
- Confidence: ${conflict.claim_a.confidence.toFixed(2)}
- Context: "${conflict.claim_a.context || 'none'}"

CLAIM B:
- Value: ${conflict.claim_b.value}
- Source: ${conflict.claim_b.source_domain || 'unknown'}
- Authority Tier: ${conflict.claim_b.source_tier || 3} (1=highest, 4=lowest)
- Confidence: ${conflict.claim_b.confidence.toFixed(2)}
- Context: "${conflict.claim_b.context || 'none'}"

Analyze the conflict and determine which claim is more likely correct. Consider:
1. Source authority (official sources like .gov, .edu are more reliable)
2. Specificity of the date (exact dates vs years)
3. Context and surrounding evidence
4. Whether both claims could be valid (e.g., different events)

Return ONLY valid JSON:
{
  "resolution": "claim_a" | "claim_b" | "both_valid" | "needs_review",
  "reasoning": "explanation (2-3 sentences)",
  "confidence": 0.0-1.0,
  "merged_value": "optional - if both_valid, suggest merged representation"
}`;

      const response = await ollamaGenerate(prompt, {
        model: 'qwen2.5:32b',
        temperature: 0.3,
        maxTokens: 500,
      });

      if (!response) {
        return {
          ...ruleBasedSuggestion,
          reviewNotes: 'LLM unavailable - using rule-based suggestion',
        };
      }

      // Parse LLM response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          resolution: string;
          reasoning: string;
          confidence: number;
          merged_value?: string;
        };

        const resolution = parsed.resolution as 'claim_a' | 'claim_b' | 'both_valid' | 'needs_review';
        return {
          suggestedResolution: resolution,
          reasoning: parsed.reasoning,
          confidence: Math.min(1, Math.max(0, parsed.confidence)),
          strategy: 'llm_analysis',
          suggestedMergedValue: parsed.merged_value,
        };
      }

      // Fallback if parsing fails
      return {
        ...ruleBasedSuggestion,
        reviewNotes: 'LLM response parsing failed - using rule-based suggestion',
      };
    } catch (error) {
      console.error('[ConflictDetection] LLM resolution failed:', error);
      return {
        ...ruleBasedSuggestion,
        reviewNotes: `LLM error: ${error instanceof Error ? error.message : 'Unknown'} - using rule-based suggestion`,
      };
    }
  }

  /**
   * Flag timeline events for review when conflicts are detected
   * Per LLM Tools Overhaul: Third strategy - flag for review
   *
   * @param locid - Location ID
   * @param eventIds - Event IDs to flag (or all conflicting events if not provided)
   * @returns Number of events flagged
   */
  flagTimelineEventsForReview(locid: string, eventIds?: string[]): number {
    if (eventIds && eventIds.length > 0) {
      // Flag specific events
      const stmt = this.db.prepare(`
        UPDATE location_timeline
        SET needs_review = 1
        WHERE locid = ? AND event_id IN (${eventIds.map(() => '?').join(',')})
      `);
      const result = stmt.run(locid, ...eventIds);
      return result.changes;
    }

    // Flag all events involved in unresolved conflicts
    const conflicts = this.getConflictsForLocation(locid, false);
    if (conflicts.length === 0) return 0;

    // Get all source refs from conflicts
    const sourceRefs = new Set<string>();
    for (const conflict of conflicts) {
      sourceRefs.add(conflict.claim_a.source_ref);
      sourceRefs.add(conflict.claim_b.source_ref);
    }

    // Find and flag timeline events from these sources
    const result = this.db.prepare(`
      UPDATE location_timeline
      SET needs_review = 1
      WHERE locid = ?
        AND (
          source_refs LIKE '%' || ? || '%'
          OR source_refs LIKE '%' || ? || '%'
        )
    `).run(locid, ...Array.from(sourceRefs).slice(0, 2));

    return result.changes;
  }

  /**
   * Get conflicts with suggestions attached
   *
   * @param locid - Location ID
   * @param useLLM - Whether to use LLM for suggestions (async)
   * @returns Conflicts with resolution suggestions
   */
  async getConflictsWithSuggestions(
    locid: string,
    useLLM = false
  ): Promise<FactConflictWithSuggestion[]> {
    const conflicts = this.getConflictsForLocation(locid, false);
    const results: FactConflictWithSuggestion[] = [];

    for (const conflict of conflicts) {
      const suggestion = useLLM
        ? await this.suggestLLMResolution(conflict)
        : this.suggestResolution(conflict);

      results.push({
        ...conflict,
        suggestion,
      });
    }

    return results;
  }

  /**
   * Auto-resolve conflicts where suggestion confidence is high
   *
   * @param locid - Location ID
   * @param minConfidence - Minimum confidence to auto-resolve (default 0.8)
   * @param resolvedBy - User/system ID performing resolution
   * @returns Number of conflicts auto-resolved
   */
  async autoResolveHighConfidence(
    locid: string,
    minConfidence = 0.8,
    resolvedBy = 'system'
  ): Promise<number> {
    const conflicts = await this.getConflictsWithSuggestions(locid, true);
    let resolved = 0;

    for (const conflict of conflicts) {
      if (
        conflict.suggestion &&
        conflict.suggestion.confidence >= minConfidence &&
        conflict.suggestion.suggestedResolution !== 'needs_review'
      ) {
        // Map suggestion to resolution
        const resolution = conflict.suggestion.suggestedResolution === 'both_valid'
          ? 'both_valid' as ConflictResolution
          : conflict.suggestion.suggestedResolution as ConflictResolution;

        this.resolveConflict({
          conflict_id: conflict.conflict_id,
          resolution,
          resolution_notes: `Auto-resolved by ${conflict.suggestion.strategy}: ${conflict.suggestion.reasoning}`,
          resolved_by: resolvedBy,
        });

        resolved++;
      }
    }

    return resolved;
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let serviceInstance: ConflictDetectionService | null = null;

/**
 * Get the conflict detection service singleton
 */
export function getConflictDetectionService(db: SqliteDatabase): ConflictDetectionService {
  if (!serviceInstance) {
    serviceInstance = new ConflictDetectionService(db);
  }
  return serviceInstance;
}
