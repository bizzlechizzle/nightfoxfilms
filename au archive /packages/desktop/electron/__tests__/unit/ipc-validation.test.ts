import { describe, it, expect } from 'vitest';
import {
  validate,
  Hex16IdSchema,
  LimitSchema,
  OffsetSchema,
  FilePathSchema,
  UrlSchema,
  PaginationSchema,
  ChunkOffsetSchema,
  TotalOverallSchema,
} from '../../main/ipc-validation';
import { z } from 'zod';

describe('IPC Validation', () => {
  // ADR-049: Unified 16-char hex ID format
  describe('Hex16IdSchema', () => {
    it('should validate correct 16-char hex IDs', () => {
      const validIds = [
        'a7f3b2c1e9d4f086',  // Standard 16-char lowercase hex
        '0000000000000000',  // All zeros
        'ffffffffffffffff',  // All f's
        '1234567890abcdef',  // Mixed digits and letters
      ];

      validIds.forEach((id) => {
        expect(() => Hex16IdSchema.parse(id)).not.toThrow();
      });
    });

    it('should reject invalid hex IDs', () => {
      const invalidIds = [
        'not-a-hex-id',                           // Not hex
        '123456',                                 // Too short
        'a7f3b2c1e9d4f0867',                      // 17 chars (too long)
        '',                                       // Empty
        'A7F3B2C1E9D4F086',                       // Uppercase (must be lowercase)
        '123e4567-e89b-12d3-a456-426614174000',  // UUID format (not allowed)
        'g7f3b2c1e9d4f086',                       // Invalid hex char 'g'
      ];

      invalidIds.forEach((id) => {
        expect(() => Hex16IdSchema.parse(id)).toThrow();
      });
    });
  });

  describe('LimitSchema', () => {
    it('should accept valid limits', () => {
      expect(LimitSchema.parse(10)).toBe(10);
      expect(LimitSchema.parse(100)).toBe(100);
      expect(LimitSchema.parse(1000)).toBe(1000);
      expect(LimitSchema.parse(1)).toBe(1);
    });

    it('should use default value of 10 when undefined', () => {
      expect(LimitSchema.parse(undefined)).toBe(10);
    });

    it('should reject limits over 1000', () => {
      expect(() => LimitSchema.parse(1001)).toThrow();
      expect(() => LimitSchema.parse(10000)).toThrow();
    });

    it('should reject negative and zero limits', () => {
      expect(() => LimitSchema.parse(0)).toThrow();
      expect(() => LimitSchema.parse(-1)).toThrow();
      expect(() => LimitSchema.parse(-100)).toThrow();
    });

    it('should reject non-integer limits', () => {
      expect(() => LimitSchema.parse(10.5)).toThrow();
      expect(() => LimitSchema.parse(99.99)).toThrow();
    });
  });

  describe('OffsetSchema', () => {
    it('should accept valid offsets', () => {
      expect(OffsetSchema.parse(0)).toBe(0);
      expect(OffsetSchema.parse(10)).toBe(10);
      expect(OffsetSchema.parse(1000)).toBe(1000);
    });

    it('should use default value of 0 when undefined', () => {
      expect(OffsetSchema.parse(undefined)).toBe(0);
    });

    it('should reject negative offsets', () => {
      expect(() => OffsetSchema.parse(-1)).toThrow();
      expect(() => OffsetSchema.parse(-100)).toThrow();
    });

    it('should reject non-integer offsets', () => {
      expect(() => OffsetSchema.parse(10.5)).toThrow();
    });
  });

  describe('FilePathSchema', () => {
    it('should accept valid file paths', () => {
      const validPaths = [
        '/home/user/file.txt',
        'C:\\Users\\User\\file.txt',
        './relative/path.jpg',
        'simple-file.pdf',
      ];

      validPaths.forEach((path) => {
        expect(() => FilePathSchema.parse(path)).not.toThrow();
      });
    });

    it('should reject empty paths', () => {
      expect(() => FilePathSchema.parse('')).toThrow();
    });

    it('should reject paths exceeding 4096 characters', () => {
      const longPath = 'a'.repeat(4097);
      expect(() => FilePathSchema.parse(longPath)).toThrow();
    });

    it('should accept paths at the limit (4096 chars)', () => {
      const maxPath = 'a'.repeat(4096);
      expect(() => FilePathSchema.parse(maxPath)).not.toThrow();
    });
  });

  describe('UrlSchema', () => {
    it('should accept valid URLs', () => {
      const validUrls = [
        'https://example.com',
        'http://localhost:3000',
        'https://sub.domain.example.com/path?query=value',
        'ftp://ftp.example.com/file.txt',
      ];

      validUrls.forEach((url) => {
        expect(() => UrlSchema.parse(url)).not.toThrow();
      });
    });

    it('should reject invalid URLs', () => {
      const invalidUrls = [
        'not-a-url',
        'example.com', // missing protocol
        'http://',
        '',
      ];

      invalidUrls.forEach((url) => {
        expect(() => UrlSchema.parse(url)).toThrow();
      });
    });

    it('should reject URLs exceeding 2048 characters', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(2040);
      expect(() => UrlSchema.parse(longUrl)).toThrow();
    });
  });

  describe('PaginationSchema', () => {
    it('should parse valid pagination params', () => {
      const result = PaginationSchema.parse({ limit: 20, offset: 40 });
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(40);
    });

    it('should use defaults when params are undefined', () => {
      const result = PaginationSchema.parse({});
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(0);
    });

    it('should reject invalid pagination params', () => {
      expect(() => PaginationSchema.parse({ limit: -1, offset: 0 })).toThrow();
      expect(() => PaginationSchema.parse({ limit: 10, offset: -1 })).toThrow();
      expect(() => PaginationSchema.parse({ limit: 2000, offset: 0 })).toThrow();
    });
  });

  // OPT-058: Unified progress tracking schemas
  describe('ChunkOffsetSchema', () => {
    it('should accept valid chunk offsets', () => {
      expect(ChunkOffsetSchema.parse(0)).toBe(0);
      expect(ChunkOffsetSchema.parse(50)).toBe(50);
      expect(ChunkOffsetSchema.parse(100)).toBe(100);
      expect(ChunkOffsetSchema.parse(1000)).toBe(1000);
    });

    it('should use default value of 0 when undefined', () => {
      expect(ChunkOffsetSchema.parse(undefined)).toBe(0);
    });

    it('should reject negative chunk offsets', () => {
      expect(() => ChunkOffsetSchema.parse(-1)).toThrow();
      expect(() => ChunkOffsetSchema.parse(-50)).toThrow();
    });

    it('should reject non-integer chunk offsets', () => {
      expect(() => ChunkOffsetSchema.parse(10.5)).toThrow();
      expect(() => ChunkOffsetSchema.parse(50.99)).toThrow();
    });
  });

  describe('TotalOverallSchema', () => {
    it('should accept valid total counts', () => {
      expect(TotalOverallSchema.parse(1)).toBe(1);
      expect(TotalOverallSchema.parse(50)).toBe(50);
      expect(TotalOverallSchema.parse(150)).toBe(150);
      expect(TotalOverallSchema.parse(10000)).toBe(10000);
    });

    it('should allow undefined (optional)', () => {
      expect(TotalOverallSchema.parse(undefined)).toBeUndefined();
    });

    it('should reject zero', () => {
      expect(() => TotalOverallSchema.parse(0)).toThrow();
    });

    it('should reject negative totals', () => {
      expect(() => TotalOverallSchema.parse(-1)).toThrow();
      expect(() => TotalOverallSchema.parse(-100)).toThrow();
    });

    it('should reject non-integer totals', () => {
      expect(() => TotalOverallSchema.parse(10.5)).toThrow();
      expect(() => TotalOverallSchema.parse(99.99)).toThrow();
    });
  });

  describe('validate helper', () => {
    it('should return parsed data for valid input', () => {
      const schema = z.object({ name: z.string(), age: z.number() });
      const data = { name: 'John', age: 30 };

      const result = validate(schema, data);
      expect(result).toEqual(data);
    });

    it('should throw readable error for invalid input', () => {
      const schema = z.object({ name: z.string(), age: z.number() });
      const invalidData = { name: 'John', age: 'thirty' };

      expect(() => validate(schema, invalidData)).toThrow('Validation error');
      expect(() => validate(schema, invalidData)).toThrow('age');
    });

    it('should handle nested validation errors', () => {
      const schema = z.object({
        user: z.object({
          email: z.string().email(),
        }),
      });
      const invalidData = { user: { email: 'invalid-email' } };

      expect(() => validate(schema, invalidData)).toThrow('Validation error');
      expect(() => validate(schema, invalidData)).toThrow('email');
    });
  });
});
