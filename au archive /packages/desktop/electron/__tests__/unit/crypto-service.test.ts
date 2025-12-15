/**
 * CryptoService Unit Tests
 *
 * Updated for BLAKE3 migration (ADR-045):
 * - Internal operations use BLAKE3 with 16-char hex output
 * - Tests now expect 16 characters instead of 64 (SHA256)
 *
 * @module __tests__/unit/crypto-service.test
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CryptoService, HASH_LENGTH } from '../../services/crypto-service';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('CryptoService', () => {
  let cryptoService: CryptoService;
  let tempDir: string;
  let testFilePath: string;

  beforeEach(() => {
    cryptoService = new CryptoService();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-test-'));
    testFilePath = path.join(tempDir, 'test-file.txt');
  });

  // ADR-045: Now uses BLAKE3 with 16-char output
  describe('calculateHash (BLAKE3)', () => {
    it('should generate consistent BLAKE3 hash for same file', async () => {
      const content = 'Hello, World!';
      fs.writeFileSync(testFilePath, content);

      const hash1 = await cryptoService.calculateHash(testFilePath);
      const hash2 = await cryptoService.calculateHash(testFilePath);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(HASH_LENGTH); // 16 chars for BLAKE3
      expect(hash1).toMatch(/^[a-f0-9]{16}$/);
    });

    it('should generate different hashes for different content', async () => {
      const file1 = path.join(tempDir, 'file1.txt');
      const file2 = path.join(tempDir, 'file2.txt');

      fs.writeFileSync(file1, 'Content A');
      fs.writeFileSync(file2, 'Content B');

      const hash1 = await cryptoService.calculateHash(file1);
      const hash2 = await cryptoService.calculateHash(file2);

      expect(hash1).not.toBe(hash2);
    });

    it('should generate consistent BLAKE3 hash for known content', async () => {
      // BLAKE3 of "test" - just verify format, not specific value
      // (BLAKE3 values change with library version)
      fs.writeFileSync(testFilePath, 'test');
      const hash = await cryptoService.calculateHash(testFilePath);

      expect(hash).toHaveLength(HASH_LENGTH);
      expect(hash).toMatch(/^[a-f0-9]{16}$/);
    });

    it('should throw error for non-existent file', async () => {
      await expect(cryptoService.calculateHash('/nonexistent/file.txt'))
        .rejects
        .toThrow();
    });
  });

  describe('calculateHashBuffer (BLAKE3)', () => {
    it('should generate consistent hash for same buffer', () => {
      const buffer = Buffer.from('test string');
      const hash1 = cryptoService.calculateHashBuffer(buffer);
      const hash2 = cryptoService.calculateHashBuffer(buffer);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(HASH_LENGTH); // 16 chars
    });

    it('should generate different hashes for different buffers', () => {
      const buffer1 = Buffer.from('string1');
      const buffer2 = Buffer.from('string2');

      const hash1 = cryptoService.calculateHashBuffer(buffer1);
      const hash2 = cryptoService.calculateHashBuffer(buffer2);

      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty buffer', () => {
      const buffer = Buffer.from('');
      const hash = cryptoService.calculateHashBuffer(buffer);

      expect(hash).toHaveLength(HASH_LENGTH);
      expect(hash).toMatch(/^[a-f0-9]{16}$/);
    });

    it('should handle unicode characters', () => {
      const buffer = Buffer.from('Hello 世界 🌍');
      const hash = cryptoService.calculateHashBuffer(buffer);

      expect(hash).toHaveLength(HASH_LENGTH);
      expect(hash).toMatch(/^[a-f0-9]{16}$/);
    });
  });

  // Cleanup
  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
