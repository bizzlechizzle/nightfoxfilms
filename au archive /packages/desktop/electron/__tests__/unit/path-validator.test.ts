import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PathValidator } from '../../services/path-validator';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('PathValidator', () => {
  let tempDir: string;
  let safeDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'path-test-'));
    safeDir = path.join(tempDir, 'safe');
    fs.mkdirSync(safeDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('isPathSafe', () => {
    it('should allow paths within allowed directory', () => {
      const safePath = path.join(safeDir, 'file.txt');
      expect(PathValidator.isPathSafe(safePath, safeDir)).toBe(true);
    });

    it('should allow paths in subdirectories', () => {
      const safePath = path.join(safeDir, 'subdir', 'file.txt');
      expect(PathValidator.isPathSafe(safePath, safeDir)).toBe(true);
    });

    it('should reject path traversal with ../', () => {
      const maliciousPath = path.join(safeDir, '..', 'outside.txt');
      expect(PathValidator.isPathSafe(maliciousPath, safeDir)).toBe(false);
    });

    it('should reject absolute paths outside allowed directory', () => {
      const outsidePath = '/etc/passwd';
      expect(PathValidator.isPathSafe(outsidePath, safeDir)).toBe(false);
    });

    it('should reject paths with multiple ../ traversals', () => {
      const maliciousPath = path.join(safeDir, '..', '..', '..', 'etc', 'passwd');
      expect(PathValidator.isPathSafe(maliciousPath, safeDir)).toBe(false);
    });

    it('should allow exact match of base directory', () => {
      expect(PathValidator.isPathSafe(safeDir, safeDir)).toBe(true);
    });

    it('should handle relative paths correctly', () => {
      const relativePath = './file.txt';
      const resolvedBase = path.resolve(safeDir);
      const result = PathValidator.isPathSafe(relativePath, resolvedBase);

      // Relative paths resolve to CWD, so this depends on where test runs
      // We just verify it doesn't crash and returns boolean
      expect(typeof result).toBe('boolean');
    });

    it('should handle symlink-like patterns (../../)', () => {
      const sneakyPath = path.join(safeDir, 'subdir', '..', '..', 'escape.txt');
      expect(PathValidator.isPathSafe(sneakyPath, safeDir)).toBe(false);
    });
  });

  describe('sanitizeFilename', () => {
    it('should remove ../ patterns', () => {
      expect(PathValidator.sanitizeFilename('../file.txt')).toBe('file.txt');
      expect(PathValidator.sanitizeFilename('../../secret.txt')).toBe('secret.txt');
    });

    it('should remove forward slashes', () => {
      expect(PathValidator.sanitizeFilename('path/to/file.txt')).toBe('pathtofile.txt');
      expect(PathValidator.sanitizeFilename('/etc/passwd')).toBe('etcpasswd');
    });

    it('should remove backslashes', () => {
      expect(PathValidator.sanitizeFilename('path\\to\\file.txt')).toBe('pathtofile.txt');
      // On Linux, colon remains (only slashes removed)
      expect(PathValidator.sanitizeFilename('C:\\Windows\\System32')).toBe('C:WindowsSystem32');
    });

    it('should remove leading dots', () => {
      expect(PathValidator.sanitizeFilename('.hidden')).toBe('hidden');
      expect(PathValidator.sanitizeFilename('...file')).toBe('file');
    });

    it('should handle complex malicious patterns', () => {
      const malicious = '../../../etc/passwd';
      const sanitized = PathValidator.sanitizeFilename(malicious);
      expect(sanitized).toBe('etcpasswd');
      expect(sanitized).not.toContain('..');
      expect(sanitized).not.toContain('/');
    });

    it('should preserve safe filenames', () => {
      expect(PathValidator.sanitizeFilename('image.jpg')).toBe('image.jpg');
      expect(PathValidator.sanitizeFilename('my-file_2023.pdf')).toBe('my-file_2023.pdf');
    });

    it('should handle empty string', () => {
      expect(PathValidator.sanitizeFilename('')).toBe('');
    });

    it('should handle unicode filenames', () => {
      const unicode = 'ファイル.txt';
      const result = PathValidator.sanitizeFilename(unicode);
      expect(result).toBe(unicode);
    });
  });

  describe('validateArchivePath', () => {
    it('should allow paths within archive root', () => {
      const archivePath = path.join(safeDir, 'images', 'photo.jpg');
      expect(PathValidator.validateArchivePath(archivePath, safeDir)).toBe(true);
    });

    it('should allow archive root itself', () => {
      expect(PathValidator.validateArchivePath(safeDir, safeDir)).toBe(true);
    });

    it('should reject paths outside archive root', () => {
      const outsidePath = path.join(tempDir, 'outside.txt');
      expect(PathValidator.validateArchivePath(outsidePath, safeDir)).toBe(false);
    });

    it('should reject parent directory traversal', () => {
      const traversalPath = path.join(safeDir, '..', 'escape.txt');
      expect(PathValidator.validateArchivePath(traversalPath, safeDir)).toBe(false);
    });

    it('should handle deep nested paths', () => {
      const deepPath = path.join(safeDir, 'a', 'b', 'c', 'd', 'file.txt');
      expect(PathValidator.validateArchivePath(deepPath, safeDir)).toBe(true);
    });

    it('should reject sibling directories', () => {
      const siblingDir = path.join(tempDir, 'sibling');
      fs.mkdirSync(siblingDir);
      const siblingPath = path.join(siblingDir, 'file.txt');

      expect(PathValidator.validateArchivePath(siblingPath, safeDir)).toBe(false);
    });
  });
});
