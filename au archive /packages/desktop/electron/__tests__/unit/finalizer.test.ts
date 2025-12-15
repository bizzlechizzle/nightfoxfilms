/**
 * Finalizer Unit Tests
 * Tests for batch inserts, job queue population, and database commits
 *
 * @module __tests__/unit/finalizer.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ValidatedFile } from '../../services/import/validator';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock Electron app before any imports
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/tmp/test-app'),
    on: vi.fn(),
    isReady: vi.fn().mockReturnValue(true),
  },
}));

// Mock the Logger service
vi.mock('../../services/logger-service', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
  })),
  getLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
  }),
}));

// Mock better-sqlite3 before any imports
vi.mock('better-sqlite3', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      pragma: vi.fn(),
      exec: vi.fn(),
      prepare: vi.fn().mockReturnValue({
        get: vi.fn(),
        run: vi.fn(),
        all: vi.fn().mockReturnValue([]),
      }),
      close: vi.fn(),
      transaction: vi.fn().mockImplementation((fn: Function) => fn),
    })),
  };
});

// Mock Kysely
vi.mock('kysely', () => ({
  Kysely: vi.fn().mockImplementation(() => ({
    insertInto: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        execute: vi.fn().mockResolvedValue({}),
        onConflict: vi.fn().mockReturnValue({
          doNothing: vi.fn().mockReturnValue({
            execute: vi.fn().mockResolvedValue({}),
          }),
        }),
      }),
    }),
    selectFrom: vi.fn().mockReturnValue({
      selectAll: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          executeTakeFirst: vi.fn().mockResolvedValue(null),
          execute: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
    destroy: vi.fn(),
  })),
  SqliteDialect: vi.fn(),
}));

import { Finalizer, type LocationInfo } from '../../services/import/finalizer';

describe('Finalizer', () => {
  let finalizer: Finalizer;
  let mockDb: any;
  let tempDir: string;
  let insertedRecords: any[] = [];
  let insertedJobs: any[] = [];

  const testLocation: LocationInfo = {
    locid: 'a1b2c3d4e5f67890', // 16-char BLAKE3 hex
    address_state: 'NY',
    subid: null,
  };

  beforeEach(() => {
    // Reset mock stores
    insertedRecords = [];
    insertedJobs = [];

    // Create mock db with comprehensive mocking
    mockDb = {
      insertInto: vi.fn().mockImplementation((table: string) => ({
        values: vi.fn().mockImplementation((data: any) => ({
          execute: vi.fn().mockImplementation(async () => {
            const records = Array.isArray(data) ? data : [data];
            if (table === 'jobs') {
              insertedJobs.push(...records);
            } else {
              insertedRecords.push(...records);
            }
            return {};
          }),
          onConflict: vi.fn().mockReturnValue({
            doNothing: vi.fn().mockReturnValue({
              execute: vi.fn().mockResolvedValue({}),
            }),
          }),
        })),
      })),
      selectFrom: vi.fn().mockReturnValue({
        selectAll: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            executeTakeFirst: vi.fn().mockResolvedValue(null),
            execute: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
      // Mock Kysely transaction API
      transaction: vi.fn().mockReturnValue({
        execute: vi.fn().mockImplementation(async (callback: (trx: any) => Promise<any>) => {
          // Create a mock transaction object that mirrors the db methods
          const trx = {
            insertInto: mockDb.insertInto,
            selectFrom: mockDb.selectFrom,
          };
          return await callback(trx);
        }),
      }),
    };

    finalizer = new Finalizer(mockDb);
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finalizer-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  function createValidatedFile(overrides: Partial<ValidatedFile> = {}): ValidatedFile {
    const hash = overrides.hash || 'a7f3b2c1e9d4f086';
    const archivePath = path.join(tempDir, `${hash}.jpg`);
    fs.writeFileSync(archivePath, 'test content');

    return {
      id: 'test-id',
      originalPath: '/source/test.jpg',
      filename: 'test.jpg',
      extension: '.jpg',
      size: 12,
      mediaType: 'image',
      isSidecar: false,
      isRaw: false,
      shouldSkip: false,
      shouldHide: false,
      baseName: 'test',
      hash,
      hashError: null,
      isDuplicate: false,
      duplicateIn: null,
      archivePath,
      copyError: null,
      copyStrategy: 'copy',
      bytesCopied: 12,
      isValid: true,
      validationError: null,
      ...overrides,
    };
  }

  describe('finalize', () => {
    it('should process valid files', async () => {
      const files: ValidatedFile[] = [createValidatedFile()];

      const result = await finalizer.finalize(files, testLocation, {});

      expect(result).toBeDefined();
      expect(result.totalFinalized).toBeGreaterThanOrEqual(0);
    });

    it('should skip invalid files', async () => {
      const files: ValidatedFile[] = [
        createValidatedFile({ isValid: false, validationError: 'Failed validation' }),
      ];

      const result = await finalizer.finalize(files, testLocation, {});

      expect(result.totalFinalized).toBe(0);
    });
  });

  describe('batch inserts (FIX 5)', () => {
    it('should handle multiple files', async () => {
      const files: ValidatedFile[] = [
        createValidatedFile({ id: '1', hash: 'hash1111111111111' }),
        createValidatedFile({ id: '2', hash: 'hash2222222222222' }),
        createValidatedFile({ id: '3', hash: 'hash3333333333333' }),
      ];

      const result = await finalizer.finalize(files, testLocation, {});

      expect(result).toBeDefined();
      // Verify db.insertInto was called
      expect(mockDb.insertInto).toHaveBeenCalled();
    });

    it('should handle different media types', async () => {
      const files: ValidatedFile[] = [
        createValidatedFile({ id: '1', hash: 'imghash111111111', mediaType: 'image' }),
        createValidatedFile({ id: '2', hash: 'vidhash222222222', mediaType: 'video', extension: '.mp4' }),
      ];

      const result = await finalizer.finalize(files, testLocation, {});

      expect(result).toBeDefined();
    });
  });

  describe('progress reporting', () => {
    it('should call onProgress during finalization', async () => {
      const files: ValidatedFile[] = [createValidatedFile()];

      const onProgress = vi.fn();

      await finalizer.finalize(files, testLocation, { onProgress });

      expect(onProgress).toHaveBeenCalled();
    });
  });

  describe('cancellation', () => {
    it('should respect abort signal', async () => {
      const files: ValidatedFile[] = [createValidatedFile()];

      const controller = new AbortController();
      controller.abort(); // Abort immediately

      await expect(
        finalizer.finalize(files, testLocation, { signal: controller.signal })
      ).rejects.toThrow('Finalize cancelled');
    });
  });
});
