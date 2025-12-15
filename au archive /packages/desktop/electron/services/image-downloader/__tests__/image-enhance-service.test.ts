/**
 * Unit Tests for Image Enhance Service
 *
 * Tests recursive suffix stripping, site patterns, and caching behavior.
 *
 * @module tests/image-enhance-service
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  imageEnhanceService,
  clearEnhanceCache,
  getEnhanceCacheStats,
} from '../image-enhance-service';

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  // Clear cache before each test
  clearEnhanceCache();
});

// ============================================================================
// Recursive Suffix Stripping Tests
// ============================================================================

describe('recursive suffix stripping', () => {
  it('should strip WordPress dimension suffix', async () => {
    const result = await imageEnhanceService.enhance(
      'https://example.com/wp-content/uploads/2019/10/EC01-1024x768.jpg',
      { validate: false } // Don't make network requests
    );

    // Should find EC01.jpg as a candidate
    const candidates = result.allCandidates.map((c) => c.url);
    expect(candidates).toContain('https://example.com/wp-content/uploads/2019/10/EC01.jpg');
  });

  it('should strip multiple suffixes recursively', async () => {
    const result = await imageEnhanceService.enhance(
      'https://example.com/wp-content/uploads/2019/10/EC01-2-1024x768.jpg',
      { validate: false }
    );

    const candidates = result.allCandidates.map((c) => c.url);

    // Should find intermediate step EC01-2.jpg
    expect(candidates).toContain('https://example.com/wp-content/uploads/2019/10/EC01-2.jpg');

    // Should find TRUE original EC01.jpg (key insight from user feedback!)
    expect(candidates).toContain('https://example.com/wp-content/uploads/2019/10/EC01.jpg');
  });

  it('should strip -scaled suffix', async () => {
    const result = await imageEnhanceService.enhance(
      'https://example.com/uploads/image-scaled.jpg',
      { validate: false }
    );

    const candidates = result.allCandidates.map((c) => c.url);
    expect(candidates).toContain('https://example.com/uploads/image.jpg');
  });

  it('should strip retina suffix @2x', async () => {
    const result = await imageEnhanceService.enhance(
      'https://example.com/images/photo@2x.png',
      { validate: false }
    );

    const candidates = result.allCandidates.map((c) => c.url);
    expect(candidates).toContain('https://example.com/images/photo.png');
  });

  it('should strip thumbnail suffix', async () => {
    const result = await imageEnhanceService.enhance(
      'https://example.com/images/photo-thumb.jpg',
      { validate: false }
    );

    const candidates = result.allCandidates.map((c) => c.url);
    expect(candidates).toContain('https://example.com/images/photo.jpg');
  });

  it('should strip WordPress edit hash', async () => {
    const result = await imageEnhanceService.enhance(
      'https://example.com/uploads/image-e1234567890123.jpg',
      { validate: false }
    );

    const candidates = result.allCandidates.map((c) => c.url);
    expect(candidates).toContain('https://example.com/uploads/image.jpg');
  });
});

// ============================================================================
// Site Pattern Tests (13+ patterns)
// ============================================================================

describe('site-specific patterns', () => {
  it('should handle Twitter/X image URLs', async () => {
    const result = await imageEnhanceService.enhance(
      'https://pbs.twimg.com/media/abc123?format=jpg&name=small',
      { validate: false }
    );

    const candidates = result.allCandidates.map((c) => c.url);
    // Should try name=orig
    expect(candidates.some((u) => u.includes('name=orig'))).toBe(true);
  });

  it('should handle Instagram CDN URLs', async () => {
    const result = await imageEnhanceService.enhance(
      'https://scontent-lax3-1.cdninstagram.com/v/s640x640/photo.jpg',
      { validate: false }
    );

    const candidates = result.allCandidates.map((c) => c.url);
    // Should try removing size prefix
    expect(candidates.some((u) => !u.includes('/s640x640/'))).toBe(true);
  });

  it('should handle Pinterest URLs', async () => {
    const result = await imageEnhanceService.enhance(
      'https://i.pinimg.com/236x/ab/cd/ef/abcdef.jpg',
      { validate: false }
    );

    const candidates = result.allCandidates.map((c) => c.url);
    // Should try /originals/
    expect(candidates.some((u) => u.includes('/originals/'))).toBe(true);
  });

  it('should handle Flickr URLs', async () => {
    const result = await imageEnhanceService.enhance(
      'https://live.staticflickr.com/65535/12345_abcdef_m.jpg',
      { validate: false }
    );

    const candidates = result.allCandidates.map((c) => c.url);
    // Should try _o suffix for original
    expect(candidates.some((u) => u.includes('_o.jpg'))).toBe(true);
  });

  it('should handle Imgur URLs', async () => {
    const result = await imageEnhanceService.enhance(
      'https://i.imgur.com/abcdefgh.jpg',
      { validate: false }
    );

    const candidates = result.allCandidates.map((c) => c.url);
    // Should try removing size suffix letter
    expect(candidates.some((u) => u.includes('abcdefg.jpg'))).toBe(true);
  });

  it('should handle Unsplash URLs', async () => {
    const result = await imageEnhanceService.enhance(
      'https://images.unsplash.com/photo-12345?w=800&q=80',
      { validate: false }
    );

    const candidates = result.allCandidates.map((c) => c.url);
    // Should try q=100 for max quality
    expect(candidates.some((u) => u.includes('q=100') || !u.includes('?'))).toBe(true);
  });

  it('should handle Wikimedia Commons URLs', async () => {
    const result = await imageEnhanceService.enhance(
      'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Image.jpg/800px-Image.jpg',
      { validate: false }
    );

    const candidates = result.allCandidates.map((c) => c.url);
    // Should try removing /thumb/ and size prefix
    expect(candidates.some((u) => !u.includes('/thumb/') && !u.includes('px-'))).toBe(true);
  });

  it('should handle Google Photos URLs', async () => {
    const result = await imageEnhanceService.enhance(
      'https://lh3.googleusercontent.com/abc123=w800-h600',
      { validate: false }
    );

    const candidates = result.allCandidates.map((c) => c.url);
    // Should try =w0-h0 for original size
    expect(candidates.some((u) => u.includes('=w0-h0') || u.includes('=s0'))).toBe(true);
  });

  it('should handle Shopify CDN URLs', async () => {
    const result = await imageEnhanceService.enhance(
      'https://cdn.shopify.com/s/files/1/image_800x.jpg',
      { validate: false }
    );

    const candidates = result.allCandidates.map((c) => c.url);
    // Should try removing size suffix
    expect(candidates.some((u) => !u.includes('_800x'))).toBe(true);
  });

  it('should handle Cloudinary URLs', async () => {
    const result = await imageEnhanceService.enhance(
      'https://res.cloudinary.com/demo/image/upload/w_800,h_600,c_fill/sample.jpg',
      { validate: false }
    );

    const candidates = result.allCandidates.map((c) => c.url);
    // Should try removing transformation segment
    expect(candidates.some((u) => !u.includes('w_800'))).toBe(true);
  });

  it('should strip query parameters from generic CDN URLs', async () => {
    const result = await imageEnhanceService.enhance(
      'https://cdn.example.com/images/photo.jpg?width=800&quality=80',
      { validate: false }
    );

    const candidates = result.allCandidates.map((c) => c.url);
    // Should try without query params
    expect(candidates).toContain('https://cdn.example.com/images/photo.jpg');
  });
});

// ============================================================================
// Format Preference Tests
// ============================================================================

describe('format preferences', () => {
  it('should prefer JPG over WebP when enabled', async () => {
    const result = await imageEnhanceService.enhance(
      'https://example.com/images/photo.webp',
      { validate: false, preferTraditionalFormats: true }
    );

    const candidates = result.allCandidates.map((c) => c.url);
    // Should try .jpg version
    expect(candidates.some((u) => u.endsWith('.jpg') || u.endsWith('.jpeg'))).toBe(true);
  });

  it('should not swap formats when disabled', async () => {
    const result = await imageEnhanceService.enhance(
      'https://example.com/images/photo.webp',
      { validate: false, preferTraditionalFormats: false }
    );

    const candidates = result.allCandidates.map((c) => c.url);
    // Should NOT try .jpg version (only original)
    const jpgCandidates = candidates.filter((u) => u.endsWith('.jpg') || u.endsWith('.jpeg'));
    expect(jpgCandidates.length).toBe(0);
  });
});

// ============================================================================
// Caching Tests
// ============================================================================

describe('caching', () => {
  it('should start with empty cache', () => {
    const stats = getEnhanceCacheStats();
    expect(stats.cacheSize).toBe(0);
  });

  it('should clear cache properly', () => {
    // Simulate some cache entries would be added during validation
    // Since we use validate: false, cache won't be populated
    clearEnhanceCache();
    const stats = getEnhanceCacheStats();
    expect(stats.cacheSize).toBe(0);
    expect(stats.domainsTracked).toBe(0);
  });
});

// ============================================================================
// Options Tests
// ============================================================================

describe('options', () => {
  it('should respect maxCandidates limit', async () => {
    const result = await imageEnhanceService.enhance(
      'https://example.com/wp-content/uploads/2019/10/EC01-2-1024x768.jpg',
      { validate: false, maxCandidates: 5 }
    );

    expect(result.allCandidates.length).toBeLessThanOrEqual(5);
  });

  it('should respect maxDepth for recursion', async () => {
    const result = await imageEnhanceService.enhance(
      'https://example.com/wp-content/uploads/2019/10/EC01-5-4-3-2-1-1024x768.jpg',
      { validate: false, maxDepth: 2 }
    );

    // With maxDepth: 2, should not recurse all the way
    const candidates = result.allCandidates;
    const maxDepth = Math.max(...candidates.map((c) => c.depth));
    expect(maxDepth).toBeLessThanOrEqual(2);
  });
});

// ============================================================================
// Batch Processing Tests
// ============================================================================

describe('batch processing', () => {
  it('should process multiple URLs in batch', async () => {
    const urls = [
      'https://example.com/image1-800x600.jpg',
      'https://example.com/image2-1024x768.jpg',
      'https://example.com/image3-scaled.jpg',
    ];

    const results = await imageEnhanceService.enhanceBatch(urls, { validate: false });

    expect(results.length).toBe(3);
    results.forEach((result, i) => {
      expect(result.originalUrl).toBe(urls[i]);
      expect(result.allCandidates.length).toBeGreaterThan(0);
    });
  });

  it('should handle errors gracefully in batch', async () => {
    const urls = [
      'https://example.com/valid-image.jpg',
      'not-a-valid-url', // Invalid
      'https://example.com/another-image.jpg',
    ];

    const results = await imageEnhanceService.enhanceBatch(urls, { validate: false });

    // Should still return results for all URLs
    expect(results.length).toBe(3);

    // Invalid URL should have error in result
    // The service catches errors and returns originalUrl as bestUrl
  });
});

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
  it('should handle URLs without file extension', async () => {
    const result = await imageEnhanceService.enhance(
      'https://example.com/images/photo',
      { validate: false }
    );

    // Should not crash, return original
    expect(result.originalUrl).toBe('https://example.com/images/photo');
  });

  it('should handle URLs with unusual extensions', async () => {
    const result = await imageEnhanceService.enhance(
      'https://example.com/images/photo.jfif',
      { validate: false }
    );

    expect(result.allCandidates.length).toBeGreaterThan(0);
  });

  it('should handle very long URLs', async () => {
    const longPath = 'a'.repeat(200);
    const result = await imageEnhanceService.enhance(
      `https://example.com/images/${longPath}-1024x768.jpg`,
      { validate: false }
    );

    expect(result.allCandidates.length).toBeGreaterThan(0);
  });

  it('should throw for invalid URLs', async () => {
    await expect(
      imageEnhanceService.enhance('not-a-url', { validate: false })
    ).rejects.toThrow('Invalid URL');
  });
});
