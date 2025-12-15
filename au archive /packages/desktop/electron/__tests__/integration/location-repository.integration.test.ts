import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteLocationRepository } from '../../repositories/sqlite-location-repository';
import { createTestDatabase, createTestLocation, createLocationInput } from './helpers/test-database';
import type { Kysely } from 'kysely';
import type { Database } from '../../main/database.types';

describe('SQLiteLocationRepository Integration', () => {
  let db: Kysely<Database>;
  let repo: SQLiteLocationRepository;
  let cleanup: () => void;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db;
    cleanup = testDb.cleanup;
    repo = new SQLiteLocationRepository(db);
  });

  afterEach(() => {
    cleanup();
  });

  describe('create', () => {
    it('should create a new location', async () => {
      const location = await repo.create(createLocationInput({
        locnam: 'Abandoned Factory',
        gps: {
          lat: 45.5231,
          lng: -122.6765,
          source: 'manual',
          verifiedOnMap: false
        },
        address: {
          verified: false,
          state: 'OR'
        },
        category: 'industrial',
      }));

      expect(location.locid).toBeDefined();
      expect(location.locnam).toBe('Abandoned Factory');
      expect(location.gps?.lat).toBe(45.5231);
      expect(location.gps?.lng).toBe(-122.6765);
      expect(location.address?.state).toBe('OR');
    });

    it('should generate unique locid identifiers', async () => {
      const location1 = await repo.create(createLocationInput({ locnam: 'Location 1' }));
      const location2 = await repo.create(createLocationInput({ locnam: 'Location 2' }));

      expect(location1.locid).not.toBe(location2.locid);
      expect(location1.locid).toHaveLength(16);
    });
  });

  describe('findById', () => {
    it('should find location by ID', async () => {
      const created = await repo.create(createLocationInput({ locnam: 'Test Location' }));
      const found = await repo.findById(created.locid);

      expect(found).toBeDefined();
      expect(found?.locid).toBe(created.locid);
      expect(found?.locnam).toBe('Test Location');
    });

    it('should return null for non-existent ID', async () => {
      // ADR-049: Use 16-char hex ID format
      const fakeId = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      const found = await repo.findById(fakeId);
      expect(found).toBeNull();
    });
  });

  describe('findAll', () => {
    it('should return all locations', async () => {
      await repo.create(createLocationInput({ locnam: 'Location 1' }));
      await repo.create(createLocationInput({ locnam: 'Location 2' }));
      await repo.create(createLocationInput({ locnam: 'Location 3' }));

      const locations = await repo.findAll();
      expect(locations).toHaveLength(3);
    });

    it('should filter by state', async () => {
      await repo.create(createLocationInput({
        locnam: 'Oregon Location',
        address: { verified: false, state: 'OR' }
      }));
      await repo.create(createLocationInput({
        locnam: 'Washington Location',
        address: { verified: false, state: 'WA' }
      }));

      const locations = await repo.findAll({ state: 'OR' });
      expect(locations).toHaveLength(1);
      expect(locations[0].address?.state).toBe('OR');
    });

    it('should filter by category', async () => {
      await repo.create(createLocationInput({ locnam: 'Factory', category: 'industrial' }));
      await repo.create(createLocationInput({ locnam: 'House', category: 'residential' }));

      const locations = await repo.findAll({ category: 'industrial' });
      expect(locations).toHaveLength(1);
      expect(locations[0].category).toBe('industrial');
    });
  });

  describe('update', () => {
    it('should update location fields', async () => {
      const created = await repo.create(createLocationInput({ locnam: 'Original Name' }));

      const updated = await repo.update(created.locid, {
        locnam: 'Updated Name',
      });

      expect(updated.locnam).toBe('Updated Name');
    });

    it('should update GPS coordinates', async () => {
      const created = await repo.create(createLocationInput({
        locnam: 'Test',
        gps: { lat: 45.0, lng: -122.0, source: 'manual', verifiedOnMap: false },
      }));

      const updated = await repo.update(created.locid, {
        gps: { lat: 46.0, lng: -123.0, source: 'manual', verifiedOnMap: true },
      });

      expect(updated.gps?.lat).toBe(46.0);
      expect(updated.gps?.lng).toBe(-123.0);
    });
  });

  describe('delete', () => {
    it('should delete location', async () => {
      const created = await repo.create(createLocationInput({ locnam: 'To Delete' }));

      await repo.delete(created.locid);

      const found = await repo.findById(created.locid);
      expect(found).toBeNull();
    });

    it('should not throw when deleting non-existent location', async () => {
      // ADR-049: Use 16-char hex ID format
      const fakeId = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      await expect(repo.delete(fakeId)).resolves.not.toThrow();
    });
  });

  describe('count', () => {
    it('should count all locations', async () => {
      await repo.create(createLocationInput({ locnam: 'Location 1' }));
      await repo.create(createLocationInput({ locnam: 'Location 2' }));

      const count = await repo.count();
      expect(count).toBe(2);
    });

    it('should count with filters', async () => {
      await repo.create(createLocationInput({ locnam: 'OR 1', address: { verified: false, state: 'OR' } }));
      await repo.create(createLocationInput({ locnam: 'OR 2', address: { verified: false, state: 'OR' } }));
      await repo.create(createLocationInput({ locnam: 'WA 1', address: { verified: false, state: 'WA' } }));

      const count = await repo.count({ state: 'OR' });
      expect(count).toBe(2);
    });
  });

  describe('transactions', () => {
    it('should rollback on error', async () => {
      const initialCount = await repo.count();

      try {
        await db.transaction().execute(async (trx) => {
          // Create location using raw insert with createTestLocation helper
          const testLoc = createTestLocation();
          await trx.insertInto('locs').values(testLoc).execute();

          // Force an error
          throw new Error('Test error');
        });
      } catch (error) {
        // Expected error
      }

      const finalCount = await repo.count();
      expect(finalCount).toBe(initialCount);
    });

    it('should commit on success', async () => {
      await db.transaction().execute(async (trx) => {
        const testLoc = createTestLocation();
        await trx.insertInto('locs').values(testLoc).execute();
      });

      const count = await repo.count();
      expect(count).toBe(1);
    });
  });
});
