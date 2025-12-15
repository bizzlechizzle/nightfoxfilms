/**
 * Location Tag Aggregator
 *
 * Aggregates image tags to location-level insights.
 * Updates location_tag_summary table with dominant tags,
 * suggested location type, era, and best hero candidate.
 *
 * Per CLAUDE.md Rule 9: This runs as a background task.
 *
 * @module services/tagging/location-tag-aggregator
 */

import type { Kysely } from 'kysely';
import type { Database } from '../../main/database.types';
import { getLogger } from '../logger-service';
import {
  suggestLocationType,
  suggestEra,
  detectConditions,
  type LocationTypeSuggestion,
  type EraSuggestion,
} from './urbex-taxonomy';

const logger = getLogger();

// ============================================================================
// Type Definitions
// ============================================================================

export interface LocationTagSummary {
  locid: string;
  dominantTags: string[];
  tagCounts: Record<string, number>;
  suggestedType: string | null;
  suggestedTypeConfidence: number | null;
  suggestedEra: string | null;
  suggestedEraConfidence: number | null;
  totalImages: number;
  taggedImages: number;
  interiorCount: number;
  exteriorCount: number;
  aerialCount: number;
  hasGraffiti: boolean;
  hasEquipment: boolean;
  hasDecay: boolean;
  hasNatureReclaim: boolean;
  conditionScore: number;
  bestHeroImghash: string | null;
  bestHeroScore: number | null;
}

export interface AggregationResult {
  locid: string;
  success: boolean;
  summary: LocationTagSummary | null;
  error?: string;
}

// ============================================================================
// Location Tag Aggregator
// ============================================================================

export class LocationTagAggregator {
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * Aggregate tags for a single location
   */
  async aggregateLocation(locid: string): Promise<AggregationResult> {
    try {
      // Get all images with tags for this location
      const images = await this.db
        .selectFrom('imgs')
        .select([
          'imghash',
          'auto_tags',
          'auto_tags_confidence',
          'view_type',
          'quality_score',
        ])
        .where('locid', '=', locid)
        .where('hidden', '=', 0)
        .execute();

      if (images.length === 0) {
        logger.debug('LocationTagAggregator', `No images found for location ${locid}`);
        return {
          locid,
          success: true,
          summary: null,
        };
      }

      // Aggregate tags
      const tagCounts: Record<string, number> = {};
      const allTags: string[] = [];
      let taggedImages = 0;
      let interiorCount = 0;
      let exteriorCount = 0;
      let aerialCount = 0;

      // Track best hero candidate
      let bestHeroImghash: string | null = null;
      let bestHeroScore = 0;

      for (const img of images) {
        // Count view types
        switch (img.view_type) {
          case 'interior':
            interiorCount++;
            break;
          case 'exterior':
            exteriorCount++;
            break;
          case 'aerial':
            aerialCount++;
            break;
        }

        // Track best hero (prefer exterior with high quality)
        if (img.quality_score !== null && img.quality_score > bestHeroScore) {
          // Prefer exterior for hero
          const viewBonus = img.view_type === 'exterior' ? 0.2 :
            img.view_type === 'aerial' ? 0.1 : 0;
          const adjustedScore = img.quality_score + viewBonus;

          if (adjustedScore > bestHeroScore) {
            bestHeroScore = adjustedScore;
            bestHeroImghash = img.imghash;
          }
        }

        // Parse and count tags
        if (img.auto_tags) {
          try {
            const tags = JSON.parse(img.auto_tags) as string[];
            taggedImages++;
            allTags.push(...tags);

            for (const tag of tags) {
              tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            }
          } catch {
            // Invalid JSON, skip
          }
        }
      }

      // Get dominant tags (top 20 by frequency)
      const sortedTags = Object.entries(tagCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 20);
      const dominantTags = sortedTags.map(([tag]) => tag);

      // Suggest location type and era from aggregated tags
      const typeSuggestion = suggestLocationType(allTags);
      const eraSuggestion = suggestEra(allTags);

      // Detect aggregate conditions
      const conditions = detectConditions(allTags);

      const summary: LocationTagSummary = {
        locid,
        dominantTags,
        tagCounts,
        suggestedType: typeSuggestion?.type ?? null,
        suggestedTypeConfidence: typeSuggestion?.confidence ?? null,
        suggestedEra: eraSuggestion?.era ?? null,
        suggestedEraConfidence: eraSuggestion?.confidence ?? null,
        totalImages: images.length,
        taggedImages,
        interiorCount,
        exteriorCount,
        aerialCount,
        hasGraffiti: conditions.hasGraffiti,
        hasEquipment: conditions.hasEquipment,
        hasDecay: conditions.hasDecay,
        hasNatureReclaim: conditions.hasNatureReclaim,
        conditionScore: conditions.conditionScore,
        bestHeroImghash,
        bestHeroScore: bestHeroScore > 0 ? bestHeroScore : null,
      };

      // Upsert to database
      await this.upsertSummary(summary);

      logger.info('LocationTagAggregator', `Aggregated ${taggedImages}/${images.length} tagged images for location ${locid}`);

      return {
        locid,
        success: true,
        summary,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('LocationTagAggregator', `Failed to aggregate location ${locid}: ${message}`);
      return {
        locid,
        success: false,
        summary: null,
        error: message,
      };
    }
  }

  /**
   * Upsert location tag summary to database
   */
  private async upsertSummary(summary: LocationTagSummary): Promise<void> {
    const now = new Date().toISOString();

    // Check if exists
    const existing = await this.db
      .selectFrom('location_tag_summary')
      .select('locid')
      .where('locid', '=', summary.locid)
      .executeTakeFirst();

    if (existing) {
      // Update
      await this.db
        .updateTable('location_tag_summary')
        .set({
          dominant_tags: JSON.stringify(summary.dominantTags),
          tag_counts: JSON.stringify(summary.tagCounts),
          suggested_type: summary.suggestedType,
          suggested_type_confidence: summary.suggestedTypeConfidence,
          suggested_era: summary.suggestedEra,
          suggested_era_confidence: summary.suggestedEraConfidence,
          total_images: summary.totalImages,
          tagged_images: summary.taggedImages,
          interior_count: summary.interiorCount,
          exterior_count: summary.exteriorCount,
          aerial_count: summary.aerialCount,
          has_graffiti: summary.hasGraffiti ? 1 : 0,
          has_equipment: summary.hasEquipment ? 1 : 0,
          has_decay: summary.hasDecay ? 1 : 0,
          has_nature_reclaim: summary.hasNatureReclaim ? 1 : 0,
          condition_score: summary.conditionScore,
          best_hero_imghash: summary.bestHeroImghash,
          best_hero_score: summary.bestHeroScore,
          updated_at: now,
        })
        .where('locid', '=', summary.locid)
        .execute();
    } else {
      // Insert
      await this.db
        .insertInto('location_tag_summary')
        .values({
          locid: summary.locid,
          dominant_tags: JSON.stringify(summary.dominantTags),
          tag_counts: JSON.stringify(summary.tagCounts),
          suggested_type: summary.suggestedType,
          suggested_type_confidence: summary.suggestedTypeConfidence,
          suggested_era: summary.suggestedEra,
          suggested_era_confidence: summary.suggestedEraConfidence,
          total_images: summary.totalImages,
          tagged_images: summary.taggedImages,
          interior_count: summary.interiorCount,
          exterior_count: summary.exteriorCount,
          aerial_count: summary.aerialCount,
          has_graffiti: summary.hasGraffiti ? 1 : 0,
          has_equipment: summary.hasEquipment ? 1 : 0,
          has_decay: summary.hasDecay ? 1 : 0,
          has_nature_reclaim: summary.hasNatureReclaim ? 1 : 0,
          condition_score: summary.conditionScore,
          best_hero_imghash: summary.bestHeroImghash,
          best_hero_score: summary.bestHeroScore,
          created_at: now,
          updated_at: now,
        })
        .execute();
    }
  }

  /**
   * Get tag summary for a location
   */
  async getSummary(locid: string): Promise<LocationTagSummary | null> {
    const row = await this.db
      .selectFrom('location_tag_summary')
      .selectAll()
      .where('locid', '=', locid)
      .executeTakeFirst();

    if (!row) return null;

    return {
      locid: row.locid,
      dominantTags: row.dominant_tags ? JSON.parse(row.dominant_tags) : [],
      tagCounts: row.tag_counts ? JSON.parse(row.tag_counts) : {},
      suggestedType: row.suggested_type,
      suggestedTypeConfidence: row.suggested_type_confidence,
      suggestedEra: row.suggested_era,
      suggestedEraConfidence: row.suggested_era_confidence,
      totalImages: row.total_images,
      taggedImages: row.tagged_images,
      interiorCount: row.interior_count,
      exteriorCount: row.exterior_count,
      aerialCount: row.aerial_count,
      hasGraffiti: row.has_graffiti === 1,
      hasEquipment: row.has_equipment === 1,
      hasDecay: row.has_decay === 1,
      hasNatureReclaim: row.has_nature_reclaim === 1,
      conditionScore: row.condition_score ?? 0,
      bestHeroImghash: row.best_hero_imghash,
      bestHeroScore: row.best_hero_score,
    };
  }

  /**
   * Apply suggested type/era to location if confidence is high enough
   */
  async applySuggestions(
    locid: string,
    options?: {
      typeThreshold?: number;  // Default 0.7
      eraThreshold?: number;   // Default 0.7
      overwrite?: boolean;     // Overwrite existing values, default false
    }
  ): Promise<{ typeApplied: boolean; eraApplied: boolean }> {
    const { typeThreshold = 0.7, eraThreshold = 0.7, overwrite = false } = options ?? {};

    const summary = await this.getSummary(locid);
    if (!summary) {
      return { typeApplied: false, eraApplied: false };
    }

    // Get current location values
    const loc = await this.db
      .selectFrom('locs')
      .select(['location_type', 'era'])
      .where('locid', '=', locid)
      .executeTakeFirst();

    if (!loc) {
      return { typeApplied: false, eraApplied: false };
    }

    const updates: { location_type?: string; era?: string } = {};

    // Apply type if confident enough and not already set (or overwrite enabled)
    if (
      summary.suggestedType &&
      summary.suggestedTypeConfidence &&
      summary.suggestedTypeConfidence >= typeThreshold &&
      (overwrite || !loc.location_type)
    ) {
      updates.location_type = summary.suggestedType;
    }

    // Apply era if confident enough and not already set (or overwrite enabled)
    if (
      summary.suggestedEra &&
      summary.suggestedEraConfidence &&
      summary.suggestedEraConfidence >= eraThreshold &&
      (overwrite || !loc.era)
    ) {
      updates.era = summary.suggestedEra;
    }

    if (Object.keys(updates).length === 0) {
      return { typeApplied: false, eraApplied: false };
    }

    await this.db
      .updateTable('locs')
      .set(updates)
      .where('locid', '=', locid)
      .execute();

    logger.info('LocationTagAggregator', `Applied suggestions to location ${locid}:`, updates);

    return {
      typeApplied: 'location_type' in updates,
      eraApplied: 'era' in updates,
    };
  }

  /**
   * Aggregate all locations with tagged images
   * Used for backfill or periodic refresh
   */
  async aggregateAll(
    onProgress?: (current: number, total: number, locid: string) => void
  ): Promise<{
    total: number;
    successful: number;
    failed: number;
  }> {
    // Get all locations with at least one image
    const locations = await this.db
      .selectFrom('locs')
      .select('locid')
      .where('img_count', '>', 0)
      .execute();

    const total = locations.length;
    let successful = 0;
    let failed = 0;

    for (let i = 0; i < locations.length; i++) {
      const { locid } = locations[i];
      onProgress?.(i + 1, total, locid);

      const result = await this.aggregateLocation(locid);
      if (result.success) {
        successful++;
      } else {
        failed++;
      }
    }

    return { total, successful, failed };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: LocationTagAggregator | null = null;

/**
 * Get the location tag aggregator singleton
 */
export function getLocationTagAggregator(db: Kysely<Database>): LocationTagAggregator {
  if (!instance) {
    instance = new LocationTagAggregator(db);
  }
  return instance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetLocationTagAggregator(): void {
  instance = null;
}
