/**
 * Copier Unit Tests
 * Tests for atomic copy and streaming callbacks
 * OPT-082: Pure copy only
 * ADR-046: BLAKE3 16-char hex IDs, simplified folder structure
 *
 * @module __tests__/unit/copier.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Copier, type CopiedFile, type LocationInfo } from '../../services/import/copier';
import type { HashedFile } from '../../services/import/hasher';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Copier', () => {
  let copier: Copier;
  let tempDir: string;
  let archiveDir: string;
  let sourceDir: string;

  // ADR-046: Simplified LocationInfo - BLAKE3 16-char hex IDs
  const testLocation: LocationInfo = {
    locid: 'a1b2c3d4e5f67890', // BLAKE3 16-char hex
    address_state: 'NY',
    subid: null,
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'copier-test-'));
    archiveDir = path.join(tempDir, 'archive');
    sourceDir = path.join(tempDir, 'source');

    fs.mkdirSync(archiveDir, { recursive: true });
    fs.mkdirSync(sourceDir, { recursive: true });

    copier = new Copier(archiveDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function createHashedFile(overrides: Partial<HashedFile> = {}): HashedFile {
    const filename = overrides.filename || 'test.jpg';
    const sourcePath = path.join(sourceDir, filename);
    fs.writeFileSync(sourcePath, 'test content');

    return {
      id: 'test-id',
      originalPath: sourcePath,
      filename,
      extension: '.jpg',
      size: 12, // 'test content' = 12 bytes
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
      ...overrides,
    };
  }

  describe('copy', () => {
    it('should copy files to archive location', async () => {
      const files: HashedFile[] = [createHashedFile()];

      const result = await copier.copy(files, testLocation, {});

      expect(result.totalCopied).toBe(1);
      expect(result.files[0].archivePath).not.toBeNull();
      expect(fs.existsSync(result.files[0].archivePath!)).toBe(true);
    });

    it('should create proper archive path structure', async () => {
      const files: HashedFile[] = [createHashedFile()];

      const result = await copier.copy(files, testLocation, {});

      const archivePath = result.files[0].archivePath!;
      // ADR-046: Path should include: locations/NY/a1b2c3d4e5f67890/data/org-img/
      expect(archivePath).toContain('locations');
      expect(archivePath).toContain('/NY/');
      expect(archivePath).toContain('a1b2c3d4e5f67890'); // locid
      expect(archivePath).toContain('/data/');
      expect(archivePath).toContain('org-img');
      expect(archivePath).toContain('a7f3b2c1e9d4f086.jpg');
    });

    it('should skip duplicate files', async () => {
      const files: HashedFile[] = [
        createHashedFile({ isDuplicate: true }),
      ];

      const result = await copier.copy(files, testLocation, {});

      expect(result.totalCopied).toBe(0);
      expect(result.files[0].archivePath).toBeNull();
      expect(result.files[0].copyError).toBe('Duplicate');
    });

    it('should skip files with hash errors', async () => {
      const files: HashedFile[] = [
        createHashedFile({ hash: null, hashError: 'Hashing failed' }),
      ];

      const result = await copier.copy(files, testLocation, {});

      expect(result.totalCopied).toBe(0);
      expect(result.files[0].copyError).toBe('Hashing failed');
    });

    it('should organize by media type', async () => {
      const imageFile = createHashedFile({
        id: '1',
        filename: 'image.jpg',
        mediaType: 'image',
        hash: 'a7f3b2c1e9d4f081',
      });
      const videoFile = createHashedFile({
        id: '2',
        filename: 'video.mp4',
        extension: '.mp4',
        mediaType: 'video',
        hash: 'a7f3b2c1e9d4f082',
      });
      const docFile = createHashedFile({
        id: '3',
        filename: 'doc.pdf',
        extension: '.pdf',
        mediaType: 'document',
        hash: 'a7f3b2c1e9d4f083',
      });

      const result = await copier.copy([imageFile, videoFile, docFile], testLocation, {});

      // ADR-046: Simplified folder names (no loc12 suffix)
      // Note: Files may complete in any order due to parallel processing
      const imgPath = result.files.find(f => f.mediaType === 'image')?.archivePath;
      const vidPath = result.files.find(f => f.mediaType === 'video')?.archivePath;
      const docPath = result.files.find(f => f.mediaType === 'document')?.archivePath;

      expect(imgPath).toContain('/org-img/');
      expect(vidPath).toContain('/org-vid/');
      expect(docPath).toContain('/org-doc/');
    });
  });

  describe('streaming callback (FIX 6)', () => {
    it('should call onFileComplete for each copied file', async () => {
      const files: HashedFile[] = [
        createHashedFile({ id: '1', filename: 'file1.jpg', hash: 'hash1111111111111' }),
        createHashedFile({ id: '2', filename: 'file2.jpg', hash: 'hash2222222222222' }),
        createHashedFile({ id: '3', filename: 'file3.jpg', hash: 'hash3333333333333' }),
      ];

      const onFileComplete = vi.fn();

      await copier.copy(files, testLocation, { onFileComplete });

      expect(onFileComplete).toHaveBeenCalledTimes(3);
      // Verify call signature: (file, index, total)
      // Note: Parallel processing means files may complete in any order,
      // so we verify each call has valid structure but don't assert order
      onFileComplete.mock.calls.forEach((call) => {
        expect(call[0]).toMatchObject({ archivePath: expect.any(String) });
        expect(call[1]).toBeGreaterThanOrEqual(0);
        expect(call[1]).toBeLessThan(3);
        expect(call[2]).toBe(3);
      });
    });

    it('should await async onFileComplete callback', async () => {
      const files: HashedFile[] = [createHashedFile()];

      let callbackCompleted = false;
      const onFileComplete = vi.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        callbackCompleted = true;
      });

      await copier.copy(files, testLocation, { onFileComplete });

      expect(callbackCompleted).toBe(true);
    });

    it('should include bytesCopied in result', async () => {
      const files: HashedFile[] = [createHashedFile({ size: 100 })];

      const onFileComplete = vi.fn();

      await copier.copy(files, testLocation, { onFileComplete });

      const copiedFile = onFileComplete.mock.calls[0][0] as CopiedFile;
      expect(copiedFile.bytesCopied).toBe(100);
    });
  });

  describe('copy strategy', () => {
    it('should always use copy strategy', async () => {
      const files: HashedFile[] = [createHashedFile()];

      const result = await copier.copy(files, testLocation, {});

      // OPT-082: Pure copy only
      expect(result.strategy).toBe('copy');
      expect(result.files[0].copyStrategy).toBe('copy');
    });
  });

  describe('progress reporting', () => {
    it('should call onProgress during copy', async () => {
      const files: HashedFile[] = [
        createHashedFile({ id: '1', filename: 'f1.jpg', hash: 'h1h1h1h1h1h1h1h1' }),
        createHashedFile({ id: '2', filename: 'f2.jpg', hash: 'h2h2h2h2h2h2h2h2' }),
      ];

      const onProgress = vi.fn();

      await copier.copy(files, testLocation, { onProgress });

      expect(onProgress).toHaveBeenCalled();
      // Progress should be between 40-80% range
      const calls = onProgress.mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall[0]).toBeGreaterThanOrEqual(40);
      expect(lastCall[0]).toBeLessThanOrEqual(80);
    });
  });

  describe('cancellation', () => {
    it('should throw on abort signal', async () => {
      const files: HashedFile[] = Array.from({ length: 10 }, (_, i) =>
        createHashedFile({ id: `${i}`, filename: `file${i}.jpg`, hash: `hash${i.toString().padStart(15, '0')}` })
      );

      const controller = new AbortController();
      controller.abort(); // Abort immediately

      await expect(
        copier.copy(files, testLocation, { signal: controller.signal })
      ).rejects.toThrow('Copy cancelled');
    });
  });

  describe('rollback', () => {
    it('should delete file on rollback', async () => {
      const files: HashedFile[] = [createHashedFile()];
      const result = await copier.copy(files, testLocation, {});

      const archivePath = result.files[0].archivePath!;
      expect(fs.existsSync(archivePath)).toBe(true);

      await copier.rollback(archivePath);

      expect(fs.existsSync(archivePath)).toBe(false);
    });
  });
});
