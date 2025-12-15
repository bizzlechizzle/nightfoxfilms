/**
 * OCR Service - Text extraction from images and documents
 * Migration 73: Date Engine - OCR Document Extraction
 *
 * Uses tesseract.js for optical character recognition on:
 * - Scanned documents (PDF pages, images)
 * - Historical photographs with text
 * - Signs and plaques in urbex photos
 *
 * @module services/ocr-service
 */

import Tesseract from 'tesseract.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import { getLogger } from './logger-service';

const logger = getLogger();

export interface OcrResult {
  text: string;
  confidence: number;
  wordCount: number;
  language: string;
  processingTimeMs: number;
}

export interface OcrOptions {
  /** Language code for OCR (default: 'eng') */
  language?: string;
  /** Minimum confidence threshold (0-100, default: 30) */
  minConfidence?: number;
  /** Timeout in milliseconds (default: 60000) */
  timeout?: number;
  /** Whether to preprocess the image for better OCR (default: true) */
  preprocess?: boolean;
}

const DEFAULT_OPTIONS: Required<OcrOptions> = {
  language: 'eng',
  minConfidence: 30,
  timeout: 60000,
  preprocess: true,
};

/**
 * OCR Service for extracting text from images
 */
export class OcrService {
  private worker: Tesseract.Worker | null = null;
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  /**
   * Initialize the Tesseract worker
   */
  async initialize(language: string = 'eng'): Promise<void> {
    if (this.isInitialized) return;

    // Prevent multiple simultaneous initializations
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = this.doInitialize(language);
    await this.initPromise;
  }

  private async doInitialize(language: string): Promise<void> {
    try {
      logger.info('OcrService', 'Initializing Tesseract worker...');
      this.worker = await Tesseract.createWorker(language, 1, {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            logger.debug('OcrService', `OCR progress: ${Math.round(m.progress * 100)}%`);
          }
        },
      });
      this.isInitialized = true;
      logger.info('OcrService', 'Tesseract worker initialized');
    } catch (error) {
      logger.error('OcrService', 'Failed to initialize Tesseract worker', undefined, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Extract text from an image file
   */
  async extractText(imagePath: string, options: OcrOptions = {}): Promise<OcrResult> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const startTime = Date.now();

    // Initialize if needed
    await this.initialize(opts.language);

    if (!this.worker) {
      throw new Error('OCR worker not initialized');
    }

    // Verify file exists
    try {
      await fs.access(imagePath);
    } catch {
      throw new Error(`Image file not found: ${imagePath}`);
    }

    try {
      // Set timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('OCR timeout')), opts.timeout);
      });

      // Run OCR
      const ocrPromise = this.worker.recognize(imagePath);
      const result = await Promise.race([ocrPromise, timeoutPromise]);

      const text = result.data.text.trim();
      const confidence = result.data.confidence;

      // Check confidence threshold
      if (confidence < opts.minConfidence) {
        logger.warn('OcrService', `Low confidence OCR result (${confidence}%)`, {
          imagePath,
          minConfidence: opts.minConfidence,
        });
      }

      const processingTimeMs = Date.now() - startTime;

      logger.info('OcrService', 'OCR extraction complete', {
        imagePath: path.basename(imagePath),
        confidence,
        wordCount: text.split(/\s+/).filter(Boolean).length,
        processingTimeMs,
      });

      return {
        text,
        confidence,
        wordCount: text.split(/\s+/).filter(Boolean).length,
        language: opts.language,
        processingTimeMs,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('OcrService', 'OCR extraction failed', undefined, {
        imagePath,
        error: message,
      });
      throw error;
    }
  }

  /**
   * Extract text from multiple images (batch processing)
   */
  async extractTextBatch(
    imagePaths: string[],
    options: OcrOptions = {}
  ): Promise<Map<string, OcrResult | Error>> {
    const results = new Map<string, OcrResult | Error>();

    for (const imagePath of imagePaths) {
      try {
        const result = await this.extractText(imagePath, options);
        results.set(imagePath, result);
      } catch (error) {
        results.set(imagePath, error instanceof Error ? error : new Error(String(error)));
      }
    }

    return results;
  }

  /**
   * Check if a file is suitable for OCR
   */
  isSupportedFormat(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    const supportedExtensions = [
      '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.pbm', '.webp',
    ];
    return supportedExtensions.includes(ext);
  }

  /**
   * Get supported image formats
   */
  getSupportedFormats(): string[] {
    return ['PNG', 'JPG', 'JPEG', 'GIF', 'BMP', 'PBM', 'WebP'];
  }

  /**
   * Terminate the OCR worker
   */
  async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.isInitialized = false;
      this.initPromise = null;
      logger.info('OcrService', 'Tesseract worker terminated');
    }
  }
}

// Singleton instance
let ocrServiceInstance: OcrService | null = null;

/**
 * Get the singleton OCR service instance
 */
export function getOcrService(): OcrService {
  if (!ocrServiceInstance) {
    ocrServiceInstance = new OcrService();
  }
  return ocrServiceInstance;
}

/**
 * Terminate the OCR service (for cleanup)
 */
export async function terminateOcrService(): Promise<void> {
  if (ocrServiceInstance) {
    await ocrServiceInstance.terminate();
    ocrServiceInstance = null;
  }
}
