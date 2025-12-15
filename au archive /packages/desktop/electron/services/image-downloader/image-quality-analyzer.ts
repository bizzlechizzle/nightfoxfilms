/**
 * Image Quality Analyzer
 *
 * Comprehensive image quality analysis including:
 * - Dimension verification (actual pixel dimensions from partial download)
 * - JPEG quality detection (quantization table analysis)
 * - Watermark detection (edge detection, pattern matching)
 * - Image similarity search (pHash-based, offline)
 *
 * All operations are offline-first per CLAUDE.md specs.
 * Uses sharp for image processing (already a project dependency).
 *
 * @module services/image-downloader/image-quality-analyzer
 */

import sharp from 'sharp';
import { createHash } from 'crypto';
import { getLogger } from '../logger-service';

const logger = getLogger();

// ============================================================================
// Types
// ============================================================================

export interface ImageDimensions {
  width: number;
  height: number;
  megapixels: number;
  aspectRatio: number;
  orientation: 'landscape' | 'portrait' | 'square';
}

export interface JpegQualityResult {
  estimatedQuality: number; // 0-100
  isRecompressed: boolean;
  confidence: number; // 0-1
  quantizationAverage: number;
  hasSubsampling: boolean; // 4:2:0 vs 4:4:4
  colorSpace: string;
}

export interface WatermarkAnalysis {
  hasWatermark: boolean;
  confidence: number; // 0-1
  watermarkType: 'none' | 'corner' | 'overlay' | 'text' | 'pattern';
  affectedArea: number; // percentage 0-100
  watermarkRegions: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}

export interface ImageQualityReport {
  url: string;
  dimensions: ImageDimensions;
  jpegQuality?: JpegQualityResult;
  watermark: WatermarkAnalysis;
  format: string;
  fileSize: number;
  qualityScore: number; // 0-100 composite score
  recommendation: 'excellent' | 'good' | 'acceptable' | 'poor' | 'avoid';
}

export interface SimilarImage {
  url: string;
  hash: string;
  distance: number; // Hamming distance
  similarity: number; // 0-1
  dimensions?: ImageDimensions;
  qualityScore?: number;
}

// ============================================================================
// Dimension Verification
// ============================================================================

/**
 * Get image dimensions from a URL using partial download
 * Only downloads enough bytes to read the image header
 */
export async function getImageDimensions(
  urlOrBuffer: string | Buffer,
  options: { timeout?: number } = {}
): Promise<ImageDimensions> {
  const timeout = options.timeout ?? 10000;

  let buffer: Buffer;

  if (typeof urlOrBuffer === 'string') {
    // Fetch partial content - image headers are typically in first 64KB
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(urlOrBuffer, {
        headers: {
          Range: 'bytes=0-65535', // First 64KB should contain dimensions
          'User-Agent': 'Mozilla/5.0 (compatible; AUArchive/1.0)',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok && response.status !== 206) {
        throw new Error(`HTTP ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  } else {
    buffer = urlOrBuffer;
  }

  // Use sharp to read metadata (works with partial data for most formats)
  const metadata = await sharp(buffer).metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error('Could not determine image dimensions');
  }

  const width = metadata.width;
  const height = metadata.height;
  const megapixels = (width * height) / 1000000;
  const aspectRatio = width / height;

  let orientation: 'landscape' | 'portrait' | 'square';
  if (Math.abs(aspectRatio - 1) < 0.05) {
    orientation = 'square';
  } else if (aspectRatio > 1) {
    orientation = 'landscape';
  } else {
    orientation = 'portrait';
  }

  return {
    width,
    height,
    megapixels: Math.round(megapixels * 100) / 100,
    aspectRatio: Math.round(aspectRatio * 100) / 100,
    orientation,
  };
}

/**
 * Get full image dimensions by downloading the complete file
 * More reliable but slower
 */
export async function getFullImageDimensions(
  urlOrBuffer: string | Buffer,
  options: { timeout?: number } = {}
): Promise<ImageDimensions & { fileSize: number; format: string }> {
  const timeout = options.timeout ?? 30000;

  let buffer: Buffer;

  if (typeof urlOrBuffer === 'string') {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(urlOrBuffer, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AUArchive/1.0)',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  } else {
    buffer = urlOrBuffer;
  }

  const metadata = await sharp(buffer).metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error('Could not determine image dimensions');
  }

  const width = metadata.width;
  const height = metadata.height;
  const megapixels = (width * height) / 1000000;
  const aspectRatio = width / height;

  let orientation: 'landscape' | 'portrait' | 'square';
  if (Math.abs(aspectRatio - 1) < 0.05) {
    orientation = 'square';
  } else if (aspectRatio > 1) {
    orientation = 'landscape';
  } else {
    orientation = 'portrait';
  }

  return {
    width,
    height,
    megapixels: Math.round(megapixels * 100) / 100,
    aspectRatio: Math.round(aspectRatio * 100) / 100,
    orientation,
    fileSize: buffer.length,
    format: metadata.format || 'unknown',
  };
}

// ============================================================================
// JPEG Quality Detection
// ============================================================================

/**
 * Analyze JPEG quality by examining quantization tables
 *
 * JPEG compression uses quantization tables (QT) to reduce data.
 * Higher quality = lower QT values (less quantization).
 * Re-compression typically increases QT values.
 *
 * Standard JPEG QTs:
 * - Quality 100: All 1s (no quantization)
 * - Quality 50: Standard baseline
 * - Quality 1: Maximum compression
 */
export async function analyzeJpegQuality(
  buffer: Buffer
): Promise<JpegQualityResult | null> {
  // Check if JPEG
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null; // Not a JPEG
  }

  try {
    // Parse JPEG markers to find DQT (Define Quantization Table) segments
    const qtValues: number[] = [];
    let position = 2;
    let hasSubsampling = true; // Assume 4:2:0 until proven otherwise
    let colorSpace = 'YCbCr';

    while (position < buffer.length - 2) {
      // Look for marker
      if (buffer[position] !== 0xff) {
        position++;
        continue;
      }

      const marker = buffer[position + 1];

      // DQT marker (Define Quantization Table)
      if (marker === 0xdb) {
        const length = buffer.readUInt16BE(position + 2);
        let tablePos = position + 4;
        const endPos = position + 2 + length;

        while (tablePos < endPos && tablePos < buffer.length) {
          const tableInfo = buffer[tablePos];
          const precision = (tableInfo >> 4) & 0x0f; // 0 = 8-bit, 1 = 16-bit
          const tableSize = precision === 0 ? 64 : 128;

          // Read quantization values
          for (let i = 0; i < 64 && tablePos + 1 + i < buffer.length; i++) {
            if (precision === 0) {
              qtValues.push(buffer[tablePos + 1 + i]);
            } else {
              qtValues.push(buffer.readUInt16BE(tablePos + 1 + i * 2));
            }
          }

          tablePos += 1 + tableSize;
        }

        position = endPos;
        continue;
      }

      // SOF markers (Start of Frame) - check for chroma subsampling
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const length = buffer.readUInt16BE(position + 2);
        if (position + 11 < buffer.length) {
          const numComponents = buffer[position + 9];
          if (numComponents >= 3 && position + 9 + numComponents * 3 < buffer.length) {
            // Check Y component sampling factors
            const ySamplingFactors = buffer[position + 11];
            const hSampling = (ySamplingFactors >> 4) & 0x0f;
            const vSampling = ySamplingFactors & 0x0f;

            // 4:4:4 = 1x1, 4:2:2 = 2x1, 4:2:0 = 2x2
            hasSubsampling = hSampling > 1 || vSampling > 1;
          }
        }
        position += 2 + length;
        continue;
      }

      // APP14 marker - Adobe color transform
      if (marker === 0xee) {
        const length = buffer.readUInt16BE(position + 2);
        if (position + 13 < buffer.length) {
          const adobe = buffer.slice(position + 4, position + 9).toString('ascii');
          if (adobe === 'Adobe') {
            const colorTransform = buffer[position + 15];
            if (colorTransform === 0) colorSpace = 'RGB';
            else if (colorTransform === 1) colorSpace = 'YCbCr';
            else if (colorTransform === 2) colorSpace = 'YCCK';
          }
        }
        position += 2 + length;
        continue;
      }

      // Skip to next marker
      if (marker === 0xd9) break; // EOI
      if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        position += 2;
        continue;
      }

      if (position + 4 < buffer.length) {
        const length = buffer.readUInt16BE(position + 2);
        position += 2 + length;
      } else {
        break;
      }
    }

    if (qtValues.length === 0) {
      return null;
    }

    // Calculate average quantization value
    const sum = qtValues.reduce((a, b) => a + b, 0);
    const quantizationAverage = sum / qtValues.length;

    // Estimate quality based on quantization tables
    // Lower average = higher quality
    // Typical values: Q100 ≈ 1, Q90 ≈ 3, Q80 ≈ 5, Q50 ≈ 16, Q10 ≈ 80
    let estimatedQuality: number;
    if (quantizationAverage <= 1) {
      estimatedQuality = 100;
    } else if (quantizationAverage <= 2) {
      estimatedQuality = 98;
    } else if (quantizationAverage <= 3) {
      estimatedQuality = 95;
    } else if (quantizationAverage <= 5) {
      estimatedQuality = 90;
    } else if (quantizationAverage <= 8) {
      estimatedQuality = 85;
    } else if (quantizationAverage <= 12) {
      estimatedQuality = 80;
    } else if (quantizationAverage <= 18) {
      estimatedQuality = 70;
    } else if (quantizationAverage <= 25) {
      estimatedQuality = 60;
    } else if (quantizationAverage <= 35) {
      estimatedQuality = 50;
    } else if (quantizationAverage <= 50) {
      estimatedQuality = 40;
    } else if (quantizationAverage <= 70) {
      estimatedQuality = 30;
    } else if (quantizationAverage <= 90) {
      estimatedQuality = 20;
    } else {
      estimatedQuality = Math.max(1, Math.round(100 - quantizationAverage));
    }

    // Detect re-compression indicators
    // Re-compressed images often have inconsistent QT patterns
    const qtVariance = calculateVariance(qtValues);
    const isRecompressed = qtVariance > 500 || (quantizationAverage > 10 && qtVariance < 50);

    // Confidence based on data quality
    const confidence = Math.min(1, qtValues.length / 128);

    return {
      estimatedQuality: Math.round(estimatedQuality),
      isRecompressed,
      confidence: Math.round(confidence * 100) / 100,
      quantizationAverage: Math.round(quantizationAverage * 10) / 10,
      hasSubsampling,
      colorSpace,
    };
  } catch (error) {
    logger.warn('ImageQualityAnalyzer', 'Failed to analyze JPEG quality', { error });
    return null;
  }
}

function calculateVariance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  return squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
}

// ============================================================================
// Watermark Detection
// ============================================================================

/**
 * Detect watermarks in an image using edge detection and pattern analysis
 *
 * Detection strategies:
 * 1. Corner analysis - Check for logos/text in corners (common placement)
 * 2. Overlay detection - Look for semi-transparent overlays
 * 3. Repeated patterns - Detect tiled watermarks
 * 4. Text detection - Find text-like edges in unusual positions
 */
export async function detectWatermark(
  buffer: Buffer
): Promise<WatermarkAnalysis> {
  try {
    const image = sharp(buffer);
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
      return createNoWatermarkResult();
    }

    const width = metadata.width;
    const height = metadata.height;

    // Analyze corners for watermarks (most common placement)
    const cornerSize = Math.min(Math.floor(width * 0.15), Math.floor(height * 0.15), 200);

    const corners = [
      { name: 'topLeft', x: 0, y: 0 },
      { name: 'topRight', x: width - cornerSize, y: 0 },
      { name: 'bottomLeft', x: 0, y: height - cornerSize },
      { name: 'bottomRight', x: width - cornerSize, y: height - cornerSize },
    ];

    const watermarkRegions: WatermarkAnalysis['watermarkRegions'] = [];
    let maxCornerScore = 0;

    for (const corner of corners) {
      const cornerBuffer = await image
        .clone()
        .extract({
          left: corner.x,
          top: corner.y,
          width: cornerSize,
          height: cornerSize,
        })
        .greyscale()
        .raw()
        .toBuffer();

      const edgeScore = analyzeEdgeDensity(cornerBuffer, cornerSize, cornerSize);

      // High edge density in corners often indicates watermarks
      if (edgeScore > 0.15) {
        maxCornerScore = Math.max(maxCornerScore, edgeScore);
        watermarkRegions.push({
          x: corner.x,
          y: corner.y,
          width: cornerSize,
          height: cornerSize,
        });
      }
    }

    // Check center for overlay watermarks
    const centerWidth = Math.floor(width * 0.4);
    const centerHeight = Math.floor(height * 0.2);
    const centerX = Math.floor((width - centerWidth) / 2);
    const centerY = Math.floor((height - centerHeight) / 2);

    const centerBuffer = await image
      .clone()
      .extract({
        left: centerX,
        top: centerY,
        width: centerWidth,
        height: centerHeight,
      })
      .greyscale()
      .raw()
      .toBuffer();

    const centerEdgeScore = analyzeEdgeDensity(centerBuffer, centerWidth, centerHeight);
    const hasOverlay = centerEdgeScore > 0.2;

    if (hasOverlay) {
      watermarkRegions.push({
        x: centerX,
        y: centerY,
        width: centerWidth,
        height: centerHeight,
      });
    }

    // Analyze for semi-transparent overlays by checking alpha channel variation
    let hasTransparentOverlay = false;
    if (metadata.hasAlpha) {
      const stats = await image.stats();
      if (stats.channels.length >= 4) {
        const alphaChannel = stats.channels[3];
        // High variance in alpha suggests transparency effects
        if (alphaChannel.stdev > 30 && alphaChannel.mean < 240) {
          hasTransparentOverlay = true;
        }
      }
    }

    // Determine watermark type and confidence
    let watermarkType: WatermarkAnalysis['watermarkType'] = 'none';
    let confidence = 0;

    if (watermarkRegions.length > 0 || hasTransparentOverlay) {
      if (hasOverlay) {
        watermarkType = 'overlay';
        confidence = Math.min(0.9, centerEdgeScore * 3);
      } else if (watermarkRegions.length > 0) {
        watermarkType = 'corner';
        confidence = Math.min(0.85, maxCornerScore * 3);
      }

      if (hasTransparentOverlay) {
        watermarkType = 'overlay';
        confidence = Math.max(confidence, 0.7);
      }
    }

    // Calculate affected area
    const totalArea = width * height;
    const watermarkArea = watermarkRegions.reduce(
      (sum, r) => sum + r.width * r.height,
      0
    );
    const affectedArea = Math.round((watermarkArea / totalArea) * 100);

    return {
      hasWatermark: confidence > 0.4,
      confidence: Math.round(confidence * 100) / 100,
      watermarkType,
      affectedArea,
      watermarkRegions,
    };
  } catch (error) {
    logger.warn('ImageQualityAnalyzer', 'Failed to detect watermark', { error });
    return createNoWatermarkResult();
  }
}

function createNoWatermarkResult(): WatermarkAnalysis {
  return {
    hasWatermark: false,
    confidence: 0,
    watermarkType: 'none',
    affectedArea: 0,
    watermarkRegions: [],
  };
}

/**
 * Analyze edge density in a grayscale image buffer
 * Higher density in corners/center often indicates watermarks
 */
function analyzeEdgeDensity(
  buffer: Buffer,
  width: number,
  height: number
): number {
  let edgeCount = 0;
  const threshold = 30; // Minimum gradient for edge detection

  // Simple Sobel-like edge detection
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;

      // Calculate horizontal and vertical gradients
      const gx = Math.abs(
        buffer[idx + 1] - buffer[idx - 1] +
        2 * (buffer[idx + width + 1] - buffer[idx + width - 1]) +
        buffer[idx - width + 1] - buffer[idx - width - 1]
      ) / 4;

      const gy = Math.abs(
        buffer[idx + width] - buffer[idx - width] +
        2 * (buffer[idx + width + 1] - buffer[idx - width + 1]) +
        buffer[idx + width - 1] - buffer[idx - width - 1]
      ) / 4;

      const gradient = Math.sqrt(gx * gx + gy * gy);

      if (gradient > threshold) {
        edgeCount++;
      }
    }
  }

  const totalPixels = (width - 2) * (height - 2);
  return edgeCount / totalPixels;
}

// ============================================================================
// Similarity Search (Offline pHash-based)
// ============================================================================

/**
 * Calculate perceptual hash for similarity comparison
 * Uses DCT-based algorithm compatible with existing pHash service
 */
export async function calculateSimilarityHash(buffer: Buffer): Promise<string> {
  // Resize to 32x32 and convert to grayscale for DCT
  const resized = await sharp(buffer)
    .resize(32, 32, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer();

  // Simple DCT-based hash (8x8 top-left of DCT)
  const dctValues: number[] = [];

  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let sum = 0;
      for (let x = 0; x < 32; x++) {
        for (let y = 0; y < 32; y++) {
          const pixel = resized[y * 32 + x];
          sum +=
            pixel *
            Math.cos(((2 * x + 1) * u * Math.PI) / 64) *
            Math.cos(((2 * y + 1) * v * Math.PI) / 64);
        }
      }
      dctValues.push(sum);
    }
  }

  // Skip DC component (first value), use median for threshold
  const acValues = dctValues.slice(1);
  const sorted = [...acValues].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  // Generate binary hash
  let hash = '';
  for (const value of acValues) {
    hash += value > median ? '1' : '0';
  }

  // Convert to hex (16 characters = 64 bits)
  let hexHash = '';
  for (let i = 0; i < hash.length; i += 4) {
    const nibble = hash.substring(i, i + 4);
    hexHash += parseInt(nibble, 2).toString(16);
  }

  return hexHash.padStart(16, '0').substring(0, 16);
}

/**
 * Calculate Hamming distance between two hashes
 */
export function hashDistance(hash1: string, hash2: string): number {
  if (hash1.length !== hash2.length) {
    throw new Error('Hash lengths must match');
  }

  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    const n1 = parseInt(hash1[i], 16);
    const n2 = parseInt(hash2[i], 16);
    // Count differing bits
    let xor = n1 ^ n2;
    while (xor) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

/**
 * Find similar images from a list of candidates
 */
export async function findSimilarImages(
  targetBuffer: Buffer,
  candidates: Array<{ url: string; buffer?: Buffer }>,
  options: { threshold?: number; limit?: number } = {}
): Promise<SimilarImage[]> {
  const threshold = options.threshold ?? 10; // Hamming distance threshold
  const limit = options.limit ?? 20;

  const targetHash = await calculateSimilarityHash(targetBuffer);
  const results: SimilarImage[] = [];

  for (const candidate of candidates) {
    try {
      let candidateBuffer = candidate.buffer;

      if (!candidateBuffer) {
        const response = await fetch(candidate.url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AUArchive/1.0)' },
        });
        if (!response.ok) continue;
        candidateBuffer = Buffer.from(await response.arrayBuffer());
      }

      const candidateHash = await calculateSimilarityHash(candidateBuffer);
      const distance = hashDistance(targetHash, candidateHash);

      if (distance <= threshold) {
        const similarity = 1 - distance / 64; // Max distance is 64 for 64-bit hash

        results.push({
          url: candidate.url,
          hash: candidateHash,
          distance,
          similarity: Math.round(similarity * 100) / 100,
        });
      }
    } catch (error) {
      logger.debug('ImageQualityAnalyzer', 'Failed to process candidate', {
        url: candidate.url,
        error,
      });
    }
  }

  // Sort by similarity (highest first)
  results.sort((a, b) => b.similarity - a.similarity);

  return results.slice(0, limit);
}

// ============================================================================
// Comprehensive Quality Analysis
// ============================================================================

/**
 * Perform comprehensive quality analysis on an image
 */
export async function analyzeImageQuality(
  urlOrBuffer: string | Buffer,
  options: { downloadFull?: boolean; timeout?: number } = {}
): Promise<ImageQualityReport> {
  const timeout = options.timeout ?? 30000;
  const downloadFull = options.downloadFull ?? true;

  let buffer: Buffer;
  let url = '';
  let fileSize = 0;

  if (typeof urlOrBuffer === 'string') {
    url = urlOrBuffer;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(urlOrBuffer, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AUArchive/1.0)' },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
      fileSize = buffer.length;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  } else {
    buffer = urlOrBuffer;
    fileSize = buffer.length;
  }

  // Get dimensions and format
  const metadata = await sharp(buffer).metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error('Could not determine image dimensions');
  }

  const dimensions: ImageDimensions = {
    width: metadata.width,
    height: metadata.height,
    megapixels: Math.round((metadata.width * metadata.height) / 10000) / 100,
    aspectRatio: Math.round((metadata.width / metadata.height) * 100) / 100,
    orientation:
      Math.abs(metadata.width / metadata.height - 1) < 0.05
        ? 'square'
        : metadata.width > metadata.height
        ? 'landscape'
        : 'portrait',
  };

  // Analyze JPEG quality (if applicable)
  const jpegQuality =
    metadata.format === 'jpeg' ? await analyzeJpegQuality(buffer) : undefined;

  // Detect watermarks
  const watermark = await detectWatermark(buffer);

  // Calculate composite quality score
  let qualityScore = 100;

  // Dimension factor (prefer higher resolution)
  const mpFactor = Math.min(dimensions.megapixels / 12, 1); // 12MP = max score
  qualityScore *= 0.3 + 0.7 * mpFactor;

  // JPEG quality factor
  if (jpegQuality) {
    qualityScore *= jpegQuality.estimatedQuality / 100;
    if (jpegQuality.isRecompressed) {
      qualityScore *= 0.85; // Penalty for re-compression
    }
  }

  // Watermark penalty
  if (watermark.hasWatermark) {
    qualityScore *= 1 - watermark.confidence * 0.3; // Up to 30% penalty
  }

  qualityScore = Math.round(qualityScore);

  // Determine recommendation
  let recommendation: ImageQualityReport['recommendation'];
  if (qualityScore >= 85) {
    recommendation = 'excellent';
  } else if (qualityScore >= 70) {
    recommendation = 'good';
  } else if (qualityScore >= 50) {
    recommendation = 'acceptable';
  } else if (qualityScore >= 30) {
    recommendation = 'poor';
  } else {
    recommendation = 'avoid';
  }

  return {
    url,
    dimensions,
    jpegQuality: jpegQuality ?? undefined,
    watermark,
    format: metadata.format || 'unknown',
    fileSize,
    qualityScore,
    recommendation,
  };
}

// ============================================================================
// Batch Analysis
// ============================================================================

/**
 * Analyze multiple images and rank by quality
 */
export async function analyzeAndRankImages(
  urls: string[],
  options: { concurrency?: number; timeout?: number } = {}
): Promise<Array<ImageQualityReport & { rank: number }>> {
  const concurrency = options.concurrency ?? 3;
  const timeout = options.timeout ?? 30000;

  const results: ImageQualityReport[] = [];

  // Process in batches
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async (url) => {
        try {
          return await analyzeImageQuality(url, { timeout });
        } catch (error) {
          logger.warn('ImageQualityAnalyzer', 'Failed to analyze image', { url, error });
          return null;
        }
      })
    );

    for (const result of batchResults) {
      if (result) {
        results.push(result);
      }
    }
  }

  // Sort by quality score
  results.sort((a, b) => b.qualityScore - a.qualityScore);

  // Add ranks
  return results.map((result, index) => ({
    ...result,
    rank: index + 1,
  }));
}

// Export singleton-style functions
export const imageQualityAnalyzer = {
  getImageDimensions,
  getFullImageDimensions,
  analyzeJpegQuality,
  detectWatermark,
  calculateSimilarityHash,
  hashDistance,
  findSimilarImages,
  analyzeImageQuality,
  analyzeAndRankImages,
};
