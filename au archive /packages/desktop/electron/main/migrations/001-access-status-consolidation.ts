/**
 * Migration 001: Access Status Consolidation
 *
 * Consolidates 'condition' and 'status' fields into 'access' field.
 * Per v010steps.md P0: Data Model Cleanup
 *
 * New Access Status Values:
 * - Abandoned
 * - Demolished
 * - Active
 * - Partially Active
 * - Future Classic
 * - Vacant
 * - Unknown
 *
 * IMPORTANT: Always backup database before running:
 * cp archive.db archive.db.backup
 */

import { Kysely, sql } from 'kysely';
import type { Database } from '../database.types';

export async function runMigration(db: Kysely<Database>): Promise<void> {
  console.log('Running Migration 001: Access Status Consolidation');

  // Step 1: Map existing condition/status values to access
  // Priority: access (if already set) > condition > status > 'Unknown'

  // Update access field based on condition values
  await db.executeQuery(sql`
    UPDATE locs
    SET access = CASE
      -- If access is already set, keep it
      WHEN access IS NOT NULL AND access != '' THEN access
      -- Map condition values
      WHEN condition = 'abandoned' OR condition = 'Abandoned' THEN 'Abandoned'
      WHEN condition = 'demolished' OR condition = 'Demolished' THEN 'Demolished'
      WHEN condition = 'active' OR condition = 'Active' THEN 'Active'
      WHEN condition = 'vacant' OR condition = 'Vacant' THEN 'Vacant'
      WHEN condition = 'renovated' OR condition = 'Renovated' THEN 'Active'
      WHEN condition = 'restored' OR condition = 'Restored' THEN 'Active'
      -- Map status values as fallback
      WHEN status = 'abandoned' OR status = 'Abandoned' THEN 'Abandoned'
      WHEN status = 'demolished' OR status = 'Demolished' THEN 'Demolished'
      WHEN status = 'active' OR status = 'Active' THEN 'Active'
      WHEN status = 'vacant' OR status = 'Vacant' THEN 'Vacant'
      WHEN status = 'locked' OR status = 'Locked' THEN 'Vacant'
      WHEN status = 'open' OR status = 'Open' THEN 'Abandoned'
      WHEN status = 'vandalized' OR status = 'Vandalized' THEN 'Abandoned'
      -- Default to Unknown if nothing matches
      ELSE 'Unknown'
    END
    WHERE access IS NULL OR access = ''
  `.compile(db));

  console.log('Step 1 complete: Mapped condition/status values to access');

  // Step 2: Normalize existing access values to new standard values
  await db.executeQuery(sql`
    UPDATE locs
    SET access = CASE
      WHEN access = 'Trespassing' THEN 'Abandoned'
      WHEN access NOT IN ('Abandoned', 'Demolished', 'Active', 'Partially Active', 'Future Classic', 'Vacant', 'Unknown') THEN 'Unknown'
      ELSE access
    END
  `.compile(db));

  console.log('Step 2 complete: Normalized access values');

  // Step 3: Count results for verification
  const results = await db
    .selectFrom('locs')
    .select([
      sql<string>`access`.as('access'),
      sql<number>`COUNT(*)`.as('count')
    ])
    .groupBy('access')
    .execute();

  console.log('Migration complete. Access status distribution:');
  results.forEach((row: { access: string | null; count: number }) => {
    console.log(`  ${row.access || 'NULL'}: ${row.count}`);
  });

  // Note: Column removal should be done in a separate migration
  // after verifying data integrity. SQLite doesn't support DROP COLUMN
  // directly, so we'd need to recreate the table.
  console.log('\nNote: condition and status columns still exist.');
  console.log('Run migration 002 to remove them after verifying data.');
}

export async function verifyMigration(db: Kysely<Database>): Promise<boolean> {
  // Check that all locations have an access value
  const nullCount = await db
    .selectFrom('locs')
    .select(sql<number>`COUNT(*)`.as('count'))
    .where('access', 'is', null)
    .executeTakeFirst();

  if (nullCount && nullCount.count > 0) {
    console.error(`ERROR: ${nullCount.count} locations still have NULL access`);
    return false;
  }

  // Check that all access values are valid
  const invalidCount = await db
    .selectFrom('locs')
    .select(sql<number>`COUNT(*)`.as('count'))
    .where('access', 'not in', [
      'Abandoned', 'Demolished', 'Active', 'Partially Active',
      'Future Classic', 'Vacant', 'Unknown'
    ])
    .executeTakeFirst();

  if (invalidCount && invalidCount.count > 0) {
    console.error(`ERROR: ${invalidCount.count} locations have invalid access values`);
    return false;
  }

  console.log('Migration verification passed!');
  return true;
}
