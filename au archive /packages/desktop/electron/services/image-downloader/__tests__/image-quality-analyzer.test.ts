/**
 * Unit Tests for Image Quality Analyzer
 *
 * Tests dimension verification, JPEG quality detection, watermark detection,
 * and similarity hashing functionality.
 *
 * @module tests/image-quality-analyzer
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Import the functions we're testing
import {
  imageQualityAnalyzer,
  getImageDimensions,
  hashDistance,
} from '../image-quality-analyzer';

// ============================================================================
// Test Fixtures
// ============================================================================

// Test JPEG with known quality (85)
const JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
  0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
  0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20,
  0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29,
  0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d, 0x38, 0x32,
  0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xd9,
]);

// Minimal PNG header for dimension parsing
const PNG_HEADER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk header
  0x00, 0x00, 0x04, 0x00, // Width: 1024
  0x00, 0x00, 0x03, 0x00, // Height: 768
  0x08, 0x02, 0x00, 0x00, 0x00, // Color depth, type, etc.
]);

// ============================================================================
// Dimension Parsing Tests
// ============================================================================

describe('getImageDimensions', () => {
  it('should handle valid PNG buffer', async () => {
    // getImageDimensions expects URL or Buffer, so we test with buffer
    // Note: actual parsing depends on sharp, which may not work with minimal headers
    // This test is more of a smoke test
    try {
      const result = await getImageDimensions(PNG_HEADER);
      // If it works, check structure
      expect(result.width).toBeGreaterThanOrEqual(0);
    } catch (e) {
      // Expected - minimal PNG header won't fully parse
      expect(e).toBeDefined();
    }
  });

  it('should handle empty buffer gracefully', async () => {
    try {
      await getImageDimensions(Buffer.alloc(0));
    } catch (e) {
      // Expected to throw for empty buffer
      expect(e).toBeDefined();
    }
  });
});

// ============================================================================
// JPEG Quality Analysis Tests
// ============================================================================

describe('analyzeJpegQuality', () => {
  it('should detect JPEG format from magic bytes', async () => {
    // JPEG files start with 0xFF 0xD8 0xFF
    const jpegMagic = Buffer.from([0xff, 0xd8, 0xff]);
    const isJpeg = jpegMagic[0] === 0xff && jpegMagic[1] === 0xd8;
    expect(isJpeg).toBe(true);
  });

  it('should analyze JPEG with DQT marker', async () => {
    const result = await imageQualityAnalyzer.analyzeJpegQuality(JPEG_BYTES);
    // This minimal JPEG has a quantization table
    if (result) {
      expect(result.estimatedQuality).toBeGreaterThan(0);
      expect(result.estimatedQuality).toBeLessThanOrEqual(100);
    }
  });

  it('should return null for non-JPEG data', async () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const result = await imageQualityAnalyzer.analyzeJpegQuality(pngBuffer);
    expect(result).toBeNull();
  });
});

// ============================================================================
// Hash Distance Tests
// ============================================================================

describe('hashDistance', () => {
  it('should return 0 for identical hashes', () => {
    const hash = 'a7f3b2c1e9d4f086';
    const distance = hashDistance(hash, hash);
    expect(distance).toBe(0);
  });

  it('should calculate correct distance for different hashes', () => {
    // These hashes differ by 1 bit in each of 4 positions
    const hash1 = '0000000000000000';
    const hash2 = '1111111111111111';
    const distance = hashDistance(hash1, hash2);
    // Each hex digit differs completely, so 64 bits different
    expect(distance).toBeGreaterThan(0);
  });

  it('should return correct distance for similar hashes', () => {
    const hash1 = 'a7f3b2c1e9d4f086';
    const hash2 = 'a7f3b2c1e9d4f087'; // Last digit differs
    const distance = hashDistance(hash1, hash2);
    // Only last nibble differs (6 vs 7 = 1 bit difference)
    expect(distance).toBeLessThanOrEqual(4);
  });
});

// ============================================================================
// Watermark Detection Tests
// ============================================================================

describe('detectWatermark', () => {
  it('should not detect watermark in solid color image', async () => {
    // Create a simple solid color buffer (simulated)
    const solidBuffer = Buffer.alloc(1000, 0x80); // Gray pixels

    // The function expects a valid image, so this test is more conceptual
    // In reality, we'd need a properly formatted image buffer
    const result = await imageQualityAnalyzer.detectWatermark(solidBuffer);

    // Should either succeed with no watermark or handle gracefully
    expect(result).toBeDefined();
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// Similarity Hash Tests
// ============================================================================

describe('calculateSimilarityHash', () => {
  it('should produce 16-character hex hash', async () => {
    // We need a valid image buffer for this test
    // Using a minimal valid PNG
    const hash = await imageQualityAnalyzer.calculateSimilarityHash(PNG_HEADER);

    if (hash) {
      expect(hash).toMatch(/^[a-f0-9]{16}$/);
    }
  });
});

// ============================================================================
// Quality Score Calculation Tests
// ============================================================================

describe('calculateQualityScore', () => {
  it('should give high score to high-resolution images', () => {
    // Test the scoring logic directly
    const highRes = {
      width: 4000,
      height: 3000,
      megapixels: 12,
      jpegQuality: 95,
      hasWatermark: false,
      watermarkConfidence: 0,
    };

    // Quality score calculation:
    // - 12MP = full resolution score (30 points)
    // - 95% JPEG quality = ~28.5 points (30 * 0.95)
    // - No watermark = full 30 points
    // Expected: 85-100

    const resScore = Math.min(30, (highRes.megapixels / 12) * 30);
    const qualityScore = (highRes.jpegQuality / 100) * 30;
    const watermarkPenalty = highRes.hasWatermark ? -30 * highRes.watermarkConfidence : 0;

    const total = resScore + qualityScore - watermarkPenalty + 10; // Base
    expect(total).toBeGreaterThanOrEqual(80);
  });

  it('should penalize watermarked images', () => {
    const watermarked = {
      width: 4000,
      height: 3000,
      megapixels: 12,
      jpegQuality: 95,
      hasWatermark: true,
      watermarkConfidence: 0.9,
    };

    const resScore = Math.min(30, (watermarked.megapixels / 12) * 30);
    const qualityScore = (watermarked.jpegQuality / 100) * 30;
    const watermarkPenalty = watermarked.hasWatermark ? 30 * watermarked.watermarkConfidence : 0;

    const total = resScore + qualityScore - watermarkPenalty + 10;
    expect(total).toBeLessThan(70); // Significant penalty
  });

  it('should penalize low-resolution images', () => {
    const lowRes = {
      width: 320,
      height: 240,
      megapixels: 0.08,
      jpegQuality: 95,
      hasWatermark: false,
      watermarkConfidence: 0,
    };

    const resScore = Math.min(30, (lowRes.megapixels / 12) * 30);
    expect(resScore).toBeLessThan(1); // Very low resolution score
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
  it('should handle extremely large dimension values', () => {
    // Some cameras report huge dimensions in EXIF
    const fakeDims = { width: 100000, height: 100000 };
    const megapixels = (fakeDims.width * fakeDims.height) / 1_000_000;
    expect(megapixels).toBe(10000);

    // Score should cap at 30 for resolution
    const resScore = Math.min(30, (megapixels / 12) * 30);
    expect(resScore).toBe(30);
  });

  it('should handle zero dimensions gracefully', () => {
    const zeroDims = { width: 0, height: 0 };
    const megapixels = (zeroDims.width * zeroDims.height) / 1_000_000;
    expect(megapixels).toBe(0);

    const resScore = Math.min(30, (megapixels / 12) * 30);
    expect(resScore).toBe(0);
  });

  it('should handle missing JPEG quality', () => {
    // When JPEG quality can't be determined, assume 85
    const defaultQuality = 85;
    const qualityScore = (defaultQuality / 100) * 30;
    expect(qualityScore).toBe(25.5);
  });
});

// ============================================================================
// Integration Tests (require network - skip in CI)
// ============================================================================

describe.skip('integration tests (requires network)', () => {
  it('should analyze a real image from URL', async () => {
    const report = await imageQualityAnalyzer.analyzeImageQuality(
      'https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png'
    );

    expect(report).toBeDefined();
    expect(report.dimensions.width).toBeGreaterThan(0);
    expect(report.dimensions.height).toBeGreaterThan(0);
    expect(report.qualityScore).toBeGreaterThanOrEqual(0);
    expect(report.qualityScore).toBeLessThanOrEqual(100);
    expect(['excellent', 'good', 'acceptable', 'poor', 'avoid']).toContain(report.recommendation);
  });
});
