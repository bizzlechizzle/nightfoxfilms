/**
 * Hasher Unit Tests
 * Tests for BLAKE3 hashing, duplicate detection, and streaming callbacks
 *
 * @module __tests__/unit/hasher.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ScannedFile } from '../../services/import/scanner';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Store for mock database
const mockImgHashes = new Set<string>();
const mockVidHashes = new Set<string>();
const mockDocHashes = new Set<string>();
const mockMapHashes = new Set<string>();

// Mock better-sqlite3 before any imports that use it
vi.mock('better-sqlite3', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      pragma: vi.fn(),
      exec: vi.fn().mockImplementation((sql: string) => {
        // Parse INSERT statements
        const insertMatch = sql.match(/INSERT INTO (\w+) \(\w+\) VALUES \('([^']+)'\)/);
        if (insertMatch) {
          const [, table, hash] = insertMatch;
          if (table === 'imgs') mockImgHashes.add(hash);
          if (table === 'vids') mockVidHashes.add(hash);
          if (table === 'docs') mockDocHashes.add(hash);
          if (table === 'maps') mockMapHashes.add(hash);
        }
      }),
      prepare: vi.fn().mockReturnValue({
        get: vi.fn(),
        run: vi.fn(),
        all: vi.fn().mockReturnValue([]),
      }),
      close: vi.fn(),
    })),
  };
});

// Mock Kysely
vi.mock('kysely', () => ({
  Kysely: vi.fn().mockImplementation(() => ({
    selectFrom: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockImplementation(async () => {
            // Check mock databases for duplicates
            const hash = 'a7f3b2c1e9d4f086';
            if (mockImgHashes.has(hash)) return { imghash: hash };
            if (mockVidHashes.has(hash)) return { vidhash: hash };
            if (mockDocHashes.has(hash)) return { dochash: hash };
            if (mockMapHashes.has(hash)) return { maphash: hash };
            return null;
          }),
        }),
      }),
    }),
    destroy: vi.fn(),
  })),
  SqliteDialect: vi.fn(),
}));

// Mock the worker pool since we're unit testing
vi.mock('../../services/worker-pool', () => ({
  getWorkerPool: vi.fn().mockResolvedValue({
    hashBatch: vi.fn().mockImplementation((paths: string[]) => {
      // Generate mock hashes for each file
      return Promise.resolve(
        paths.map(p => ({
          hash: 'a7f3b2c1e9d4f086', // Mock BLAKE3 hash (16 chars)
          error: null,
        }))
      );
    }),
  }),
}));

// Import after mocks are set up
import { Hasher, type HasherOptions, type HashedFile } from '../../services/import/hasher';

describe('Hasher', () => {
  let hasher: Hasher;
  let tempDir: string;
  let mockDb: any;

  beforeEach(() => {
    // Clear mock hash stores
    mockImgHashes.clear();
    mockVidHashes.clear();
    mockDocHashes.clear();
    mockMapHashes.clear();

    // Create mock db with full chain support
    mockDb = {
      selectFrom: vi.fn().mockImplementation((table: string) => ({
        select: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            execute: vi.fn().mockImplementation(async () => {
              // Return empty array by default (no duplicates)
              return [];
            }),
            executeTakeFirst: vi.fn().mockImplementation(async () => null),
          }),
        }),
        selectAll: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            execute: vi.fn().mockResolvedValue([]),
            executeTakeFirst: vi.fn().mockResolvedValue(null),
          }),
        }),
      })),
    };

    hasher = new Hasher(mockDb);
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hasher-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  function createScannedFile(overrides: Partial<ScannedFile> = {}): ScannedFile {
    const filename = overrides.filename || 'test.jpg';
    const testPath = path.join(tempDir, filename);
    fs.writeFileSync(testPath, 'test content');

    return {
      id: 'test-id',
      originalPath: testPath,
      filename,
      extension: '.jpg',
      size: 100,
      mediaType: 'image',
      isSidecar: false,
      isRaw: false,
      shouldSkip: false,
      shouldHide: false,
      baseName: 'test',
      ...overrides,
    };
  }

  describe('hash', () => {
    it('should hash all provided files', async () => {
      const files: ScannedFile[] = [
        createScannedFile({ id: '1', filename: 'file1.jpg' }),
        createScannedFile({ id: '2', filename: 'file2.jpg' }),
      ];

      const result = await hasher.hash(files, {});

      expect(result.totalHashed).toBe(2);
      expect(result.files).toHaveLength(2);
    });

    it('should skip files marked as shouldSkip', async () => {
      const files: ScannedFile[] = [
        createScannedFile({ shouldSkip: false }),
        createScannedFile({ id: '2', filename: 'skip.aae', shouldSkip: true }),
      ];

      const result = await hasher.hash(files, {});

      const skipped = result.files.find(f => f.filename === 'skip.aae');
      expect(skipped?.hash).toBeNull();
      expect(skipped?.hashError).toBe('Skipped');
    });

    it('should detect duplicates from database', async () => {
      // Update mock to return existing hash (simulate duplicate)
      mockDb.selectFrom = vi.fn().mockImplementation((table: string) => ({
        select: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            execute: vi.fn().mockResolvedValue([{ imghash: 'a7f3b2c1e9d4f086' }]),
            executeTakeFirst: vi.fn().mockResolvedValue({ imghash: 'a7f3b2c1e9d4f086' }),
          }),
        }),
      }));
      hasher = new Hasher(mockDb);

      const files: ScannedFile[] = [
        createScannedFile({ mediaType: 'image' }),
      ];

      const result = await hasher.hash(files, {});

      expect(result.totalDuplicates).toBe(1);
      expect(result.files[0].isDuplicate).toBe(true);
      expect(result.files[0].duplicateIn).toBe('imgs');
    });

    it('should detect video duplicates', async () => {
      // Update mock to return existing hash (simulate video duplicate)
      mockDb.selectFrom = vi.fn().mockImplementation((table: string) => ({
        select: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            execute: vi.fn().mockImplementation(async () => {
              // Return video hash for vids table
              if (table === 'vids') return [{ vidhash: 'a7f3b2c1e9d4f086' }];
              return [];
            }),
            executeTakeFirst: vi.fn().mockResolvedValue(null),
          }),
        }),
      }));
      hasher = new Hasher(mockDb);

      const files: ScannedFile[] = [
        createScannedFile({ mediaType: 'video', extension: '.mp4' }),
      ];

      const result = await hasher.hash(files, {});

      expect(result.totalDuplicates).toBe(1);
      expect(result.files[0].duplicateIn).toBe('vids');
    });
  });

  describe('streaming callback (FIX 6)', () => {
    it('should call onFileComplete for each hashed file', async () => {
      const files: ScannedFile[] = [
        createScannedFile({ id: '1', filename: 'file1.jpg' }),
        createScannedFile({ id: '2', filename: 'file2.jpg' }),
        createScannedFile({ id: '3', filename: 'file3.jpg' }),
      ];

      const onFileComplete = vi.fn();

      await hasher.hash(files, { onFileComplete });

      expect(onFileComplete).toHaveBeenCalledTimes(3);
      // Verify call arguments: (file, index, total)
      expect(onFileComplete).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ hash: expect.any(String) }),
        0,
        3
      );
      expect(onFileComplete).toHaveBeenNthCalledWith(
        2,
        expect.any(Object),
        1,
        3
      );
      expect(onFileComplete).toHaveBeenNthCalledWith(
        3,
        expect.any(Object),
        2,
        3
      );
    });

    it('should await async onFileComplete callback', async () => {
      const files: ScannedFile[] = [
        createScannedFile(),
      ];

      let callbackCompleted = false;
      const onFileComplete = vi.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        callbackCompleted = true;
      });

      await hasher.hash(files, { onFileComplete });

      expect(callbackCompleted).toBe(true);
    });
  });

  describe('progress reporting', () => {
    it('should call onProgress during hashing', async () => {
      const files: ScannedFile[] = [
        createScannedFile({ id: '1' }),
        createScannedFile({ id: '2' }),
      ];

      const onProgress = vi.fn();

      await hasher.hash(files, { onProgress });

      expect(onProgress).toHaveBeenCalled();
      // Progress should be between 5-40% range
      const [percent] = onProgress.mock.calls[0];
      expect(percent).toBeGreaterThanOrEqual(5);
      expect(percent).toBeLessThanOrEqual(40);
    });
  });

  describe('cancellation', () => {
    it('should throw on abort signal', async () => {
      const files: ScannedFile[] = Array.from({ length: 100 }, (_, i) =>
        createScannedFile({ id: `${i}`, filename: `file${i}.jpg` })
      );

      const controller = new AbortController();
      controller.abort(); // Abort immediately

      await expect(
        hasher.hash(files, { signal: controller.signal })
      ).rejects.toThrow('Hashing cancelled');
    });
  });
});
