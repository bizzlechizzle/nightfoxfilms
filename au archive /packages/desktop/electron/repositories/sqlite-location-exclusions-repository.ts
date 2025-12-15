/**
 * SQLite Location Exclusions Repository
 *
 * Manages storage and retrieval of "different place" decisions.
 * When a user says two locations are different, we store that decision
 * to prevent re-prompting for the same pair.
 *
 * ADR: ADR-pin-conversion-duplicate-prevention.md
 */

import { generateId } from '../main/ipc-validation';
import type { Kysely } from 'kysely';
import type { Database } from '../main/database.types';

export interface ExclusionPair {
  nameA: string;
  nameB: string;
}

export class SQLiteLocationExclusionsRepository {
  constructor(private db: Kysely<Database>) {}

  /**
   * Add an exclusion decision (two names are different places)
   * Names are normalized (lowercased) and sorted for consistent lookup
   */
  async addExclusion(nameA: string, nameB: string, decidedBy?: string): Promise<void> {
    // Normalize and sort for consistent storage/lookup
    const [first, second] = [nameA.toLowerCase().trim(), nameB.toLowerCase().trim()].sort();

    // Check if already exists
    const existing = await this.db
      .selectFrom('location_exclusions')
      .select('exclusion_id')
      .where('name_a', '=', first)
      .where('name_b', '=', second)
      .executeTakeFirst();

    if (existing) {
      console.log(`[LocationExclusions] Exclusion already exists for "${first}" / "${second}"`);
      return;
    }

    await this.db.insertInto('location_exclusions').values({
      exclusion_id: generateId(),
      name_a: first,
      name_b: second,
      decided_at: new Date().toISOString(),
      decided_by: decidedBy || null,
    }).execute();

    console.log(`[LocationExclusions] Added exclusion: "${first}" / "${second}"`);
  }

  /**
   * Check if a name pair is excluded (previously marked as different)
   */
  async isExcluded(nameA: string, nameB: string): Promise<boolean> {
    const [first, second] = [nameA.toLowerCase().trim(), nameB.toLowerCase().trim()].sort();

    const result = await this.db
      .selectFrom('location_exclusions')
      .select('exclusion_id')
      .where('name_a', '=', first)
      .where('name_b', '=', second)
      .executeTakeFirst();

    return !!result;
  }

  /**
   * Get all exclusion pairs (for passing to duplicate service)
   */
  async getAllExclusions(): Promise<ExclusionPair[]> {
    const results = await this.db
      .selectFrom('location_exclusions')
      .select(['name_a', 'name_b'])
      .execute();

    return results.map(r => ({ nameA: r.name_a, nameB: r.name_b }));
  }

  /**
   * Remove an exclusion (allow re-prompting for a pair)
   */
  async removeExclusion(nameA: string, nameB: string): Promise<boolean> {
    const [first, second] = [nameA.toLowerCase().trim(), nameB.toLowerCase().trim()].sort();

    const result = await this.db
      .deleteFrom('location_exclusions')
      .where('name_a', '=', first)
      .where('name_b', '=', second)
      .execute();

    const deleted = result[0]?.numDeletedRows ?? 0;
    if (deleted > 0) {
      console.log(`[LocationExclusions] Removed exclusion: "${first}" / "${second}"`);
    }
    return deleted > 0;
  }

  /**
   * Get count of stored exclusions
   */
  async count(): Promise<number> {
    const result = await this.db
      .selectFrom('location_exclusions')
      .select((eb) => eb.fn.count('exclusion_id').as('count'))
      .executeTakeFirst();

    return Number(result?.count || 0);
  }
}

export default SQLiteLocationExclusionsRepository;
