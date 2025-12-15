import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteMediaRepository } from '../../repositories/sqlite-media-repository';
import { SQLiteLocationRepository } from '../../repositories/sqlite-location-repository';
import { createTestDatabase, createTestImage, createLocationInput } from './helpers/test-database';
import type { Kysely } from 'kysely';
import type { Database, ImgsTable } from '../../main/database.types';

// Helper to cast test image to the expected type
type CreateImageInput = Omit<ImgsTable, 'imgadd'>;
const asCreateImageInput = (data: ReturnType<typeof createTestImage>) => data as unknown as CreateImageInput;

describe('SQLiteMediaRepository Integration', () => {
  let db: Kysely<Database>;
  let mediaRepo: SQLiteMediaRepository;
  let locationRepo: SQLiteLocationRepository;
  let cleanup: () => void;
  let testLocationId: string;

  beforeEach(async () => {
    const testDb = createTestDatabase();
    db = testDb.db;
    cleanup = testDb.cleanup;
    mediaRepo = new SQLiteMediaRepository(db);
    locationRepo = new SQLiteLocationRepository(db);

    // Create a test location for media to reference
    const location = await locationRepo.create(createLocationInput({ locnam: 'Test Location' }));
    testLocationId = location.locid;
  });

  afterEach(() => {
    cleanup();
  });

  describe('createImage', () => {
    it('should create an image', async () => {
      const imageData = asCreateImageInput(createTestImage(testLocationId, { imgnam: 'test.jpg' }));

      await mediaRepo.createImage(imageData);

      const images = await mediaRepo.findImagesByLocation(testLocationId);
      expect(images).toHaveLength(1);
      expect(images[0].imgnam).toBe('test.jpg');
    });

    it('should handle duplicate hash (same file)', async () => {
      const imageData = asCreateImageInput(createTestImage(testLocationId));

      await mediaRepo.createImage(imageData);

      // Try to insert same hash again - should fail due to PRIMARY KEY
      await expect(mediaRepo.createImage(imageData)).rejects.toThrow();
    });
  });

  describe('findImagesByLocation', () => {
    it('should find all images for a location', async () => {
      const image1 = asCreateImageInput(createTestImage(testLocationId, { imgnam: 'image1.jpg' }));
      const image2 = asCreateImageInput(createTestImage(testLocationId, { imgnam: 'image2.jpg' }));

      await mediaRepo.createImage(image1);
      await mediaRepo.createImage(image2);

      const images = await mediaRepo.findImagesByLocation(testLocationId);
      expect(images).toHaveLength(2);
    });

    it('should return empty array for location with no images', async () => {
      const images = await mediaRepo.findImagesByLocation(testLocationId);
      expect(images).toHaveLength(0);
    });
  });

  describe('findAllMediaByLocation', () => {
    it('should find all media types for a location', async () => {
      const image = asCreateImageInput(createTestImage(testLocationId));
      await mediaRepo.createImage(image);

      const media = await mediaRepo.findAllMediaByLocation(testLocationId);
      expect(media.images).toHaveLength(1);
      expect(media.videos).toHaveLength(0);
      expect(media.documents).toHaveLength(0);
    });
  });

  describe('findImageByHash', () => {
    it('should find existing image by hash', async () => {
      const image = asCreateImageInput(createTestImage(testLocationId));
      await mediaRepo.createImage(image);

      const found = await mediaRepo.findImageByHash(image.imghash);
      expect(found).toBeDefined();
      expect(found.imghash).toBe(image.imghash);
    });

    it('should throw for non-existent hash', async () => {
      // ADR-046: Use 16-char BLAKE3 hex format
      const fakeHash = 'aaaaaaaaaaaaaaaa';
      // findImageByHash throws via executeTakeFirstOrThrow
      await expect(mediaRepo.findImageByHash(fakeHash)).rejects.toThrow();
    });
  });

  describe('foreign key constraints', () => {
    it('should prevent inserting image with non-existent location', async () => {
      // ADR-049: Use 16-char hex ID format
      const fakeLocationId = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      const image = asCreateImageInput(createTestImage(fakeLocationId));

      await expect(mediaRepo.createImage(image)).rejects.toThrow();
    });

    it('should cascade delete images when location is deleted', async () => {
      const image = asCreateImageInput(createTestImage(testLocationId));
      await mediaRepo.createImage(image);

      // Delete the location
      await locationRepo.delete(testLocationId);

      // Images should be deleted too
      const images = await mediaRepo.findImagesByLocation(testLocationId);
      expect(images).toHaveLength(0);
    });
  });
});
