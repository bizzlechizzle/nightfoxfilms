/**
 * Validator Unit Tests
 * Tests for integrity verification, rollback, and streaming callbacks
 *
 * @module __tests__/unit/validator.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Validator, type ValidatedFile } from '../../services/import/validator';
import type { CopiedFile } from '../../services/import/copier';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock the worker pool
vi.mock('../../services/worker-pool', () => ({
  getWorkerPool: vi.fn().mockResolvedValue({
    // The validator uses pool.hash(filePath), not hashBatch
    hash: vi.fn().mockImplementation((_path: string) => {
      // By default, return matching hash (valid file)
      return Promise.resolve({
        hash: 'a7f3b2c1e9d4f086',
        error: null,
      });
    }),
  }),
}));

describe('Validator', () => {
  let validator: Validator;
  let tempDir: string;

  beforeEach(() => {
    validator = new Validator();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'validator-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  function createCopiedFile(overrides: Partial<CopiedFile> = {}): CopiedFile {
    const archivePath = path.join(tempDir, 'archive-file.jpg');
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
      hash: 'a7f3b2c1e9d4f086',
      hashError: null,
      isDuplicate: false,
      duplicateIn: null,
      archivePath,
      copyError: null,
      copyStrategy: 'copy',
      bytesCopied: 12,
      ...overrides,
    };
  }

  describe('validate', () => {
    it('should validate copied files by re-hashing', async () => {
      const files: CopiedFile[] = [createCopiedFile()];

      const result = await validator.validate(files, {});

      expect(result.totalValidated).toBe(1);
      expect(result.totalValid).toBe(1);
      expect(result.files[0].isValid).toBe(true);
    });

    it('should skip files without archivePath', async () => {
      const files: CopiedFile[] = [
        createCopiedFile({ archivePath: null, copyError: 'Not copied' }),
      ];

      const result = await validator.validate(files, {});

      expect(result.totalValidated).toBe(0);
      expect(result.files[0].isValid).toBe(false);
      expect(result.files[0].validationError).toBe('Not copied');
    });

    it('should detect hash mismatch', async () => {
      // Override mock to return different hash
      const { getWorkerPool } = await import('../../services/worker-pool');
      vi.mocked(getWorkerPool).mockResolvedValueOnce({
        hash: vi.fn().mockResolvedValue({ hash: 'different_hash_12', error: null }),
      } as any);

      const validator2 = new Validator();
      const files: CopiedFile[] = [createCopiedFile()];

      const result = await validator2.validate(files, { autoRollback: false });

      expect(result.totalInvalid).toBe(1);
      expect(result.files[0].isValid).toBe(false);
      expect(result.files[0].validationError).toContain('Hash mismatch');
    });

    it('should rollback invalid files when autoRollback is true', async () => {
      // Override mock to return different hash
      const { getWorkerPool } = await import('../../services/worker-pool');
      vi.mocked(getWorkerPool).mockResolvedValueOnce({
        hash: vi.fn().mockResolvedValue({ hash: 'different_hash_12', error: null }),
      } as any);

      const file = createCopiedFile();
      const archivePath = file.archivePath!;
      expect(fs.existsSync(archivePath)).toBe(true);

      const validator2 = new Validator();
      const result = await validator2.validate([file], { autoRollback: true });

      expect(result.totalRolledBack).toBe(1);
      expect(fs.existsSync(archivePath)).toBe(false);
    });

    it('should not rollback when autoRollback is false', async () => {
      // Override mock to return different hash
      const { getWorkerPool } = await import('../../services/worker-pool');
      vi.mocked(getWorkerPool).mockResolvedValueOnce({
        hash: vi.fn().mockResolvedValue({ hash: 'different_hash_12', error: null }),
      } as any);

      const file = createCopiedFile();
      const archivePath = file.archivePath!;

      const validator2 = new Validator();
      await validator2.validate([file], { autoRollback: false });

      expect(fs.existsSync(archivePath)).toBe(true);
    });
  });

  describe('streaming callback (FIX 6)', () => {
    it('should call onFileComplete for each validated file', async () => {
      const files: CopiedFile[] = [
        createCopiedFile({ id: '1', filename: 'file1.jpg' }),
        createCopiedFile({ id: '2', filename: 'file2.jpg' }),
        createCopiedFile({ id: '3', filename: 'file3.jpg' }),
      ];

      // Update archive paths to be unique
      files.forEach((f, i) => {
        const newPath = path.join(tempDir, `file${i}.jpg`);
        fs.writeFileSync(newPath, 'content');
        f.archivePath = newPath;
      });

      const onFileComplete = vi.fn();

      await validator.validate(files, { onFileComplete });

      expect(onFileComplete).toHaveBeenCalledTimes(3);
      // Verify call signature: (file, index, total)
      expect(onFileComplete).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ isValid: true }),
        0,
        3
      );
    });

    it('should await async onFileComplete callback', async () => {
      const files: CopiedFile[] = [createCopiedFile()];

      let callbackCompleted = false;
      const onFileComplete = vi.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        callbackCompleted = true;
      });

      await validator.validate(files, { onFileComplete });

      expect(callbackCompleted).toBe(true);
    });

    it('should include validation status in callback', async () => {
      const files: CopiedFile[] = [createCopiedFile()];

      const onFileComplete = vi.fn();

      await validator.validate(files, { onFileComplete });

      const validatedFile = onFileComplete.mock.calls[0][0] as ValidatedFile;
      expect(validatedFile.isValid).toBe(true);
      expect(validatedFile.validationError).toBeNull();
    });
  });

  describe('progress reporting', () => {
    it('should call onProgress during validation', async () => {
      const files: CopiedFile[] = [
        createCopiedFile({ id: '1' }),
        createCopiedFile({ id: '2' }),
      ];

      files.forEach((f, i) => {
        const newPath = path.join(tempDir, `file${i}.jpg`);
        fs.writeFileSync(newPath, 'content');
        f.archivePath = newPath;
      });

      const onProgress = vi.fn();

      await validator.validate(files, { onProgress });

      expect(onProgress).toHaveBeenCalled();
      // Progress should be between 80-95% range
      const [percent] = onProgress.mock.calls[0];
      expect(percent).toBeGreaterThanOrEqual(80);
      expect(percent).toBeLessThanOrEqual(95);
    });
  });

  describe('cancellation', () => {
    it('should throw on abort signal', async () => {
      const files: CopiedFile[] = Array.from({ length: 100 }, (_, i) =>
        createCopiedFile({ id: `${i}` })
      );

      const controller = new AbortController();
      controller.abort(); // Abort immediately

      await expect(
        validator.validate(files, { signal: controller.signal })
      ).rejects.toThrow('Validation cancelled');
    });
  });

  describe('error handling', () => {
    it('should handle hash errors gracefully', async () => {
      // Override mock to return error
      const { getWorkerPool } = await import('../../services/worker-pool');
      vi.mocked(getWorkerPool).mockResolvedValueOnce({
        hash: vi.fn().mockResolvedValue({ hash: null, error: 'File read error' }),
      } as any);

      const file = createCopiedFile();
      const validator2 = new Validator();
      const result = await validator2.validate([file], { autoRollback: false });

      expect(result.totalInvalid).toBe(1);
      expect(result.files[0].validationError).toContain('Re-hash failed');
    });
  });
});
