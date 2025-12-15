import { exiftool } from 'exiftool-vendored';

/**
 * FIX 2.3: ExifTool uses a global singleton process pool from exiftool-vendored.
 * LIMITATION: All calls share one ExifTool process pool. Under heavy load (50+ concurrent
 * file imports), the queue may back up. This is acceptable for typical use cases.
 * FUTURE: For massive batch imports, consider spawning dedicated ExifTool processes.
 */

export interface ImageMetadata {
  width: number | null;
  height: number | null;
  dateTaken: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  gps: {
    lat: number;
    lng: number;
    altitude?: number;
  } | null;
  rawExif: string;
}

// Default timeout for ExifTool operations (30 seconds)
const EXIFTOOL_TIMEOUT_MS = 30000;

/**
 * Service for extracting EXIF metadata from images using ExifTool
 */
export class ExifToolService {
  /**
   * Extract metadata from an image file with timeout protection
   * @param filePath - Absolute path to the image file
   * @param timeoutMs - Timeout in milliseconds (default: 30 seconds)
   * @returns Promise resolving to extracted metadata
   */
  async extractMetadata(filePath: string, timeoutMs: number = EXIFTOOL_TIMEOUT_MS): Promise<ImageMetadata> {
    console.log('[ExifTool] Starting metadata extraction for:', filePath);
    const startTime = Date.now();

    try {
      console.log('[ExifTool] Calling exiftool.read() with', timeoutMs, 'ms timeout...');

      // Wrap ExifTool call with timeout to prevent hangs
      const tags = await this.withTimeout(
        exiftool.read(filePath),
        timeoutMs,
        `ExifTool timed out after ${timeoutMs}ms for: ${filePath}`
      );

      console.log('[ExifTool] Extraction completed in', Date.now() - startTime, 'ms');

      // Helper to convert ExifDateTime or string to ISO string
      const toISOString = (val: unknown): string | null => {
        if (!val) return null;
        if (typeof val === 'string') return val;
        if (typeof val === 'object' && 'toISOString' in val && typeof (val as any).toISOString === 'function') {
          return (val as { toISOString(): string }).toISOString();
        }
        return String(val);
      };

      // Helper to convert GPS coordinate to number
      const toNumber = (val: unknown): number | null => {
        if (val === undefined || val === null) return null;
        if (typeof val === 'number') return val;
        if (typeof val === 'string') return parseFloat(val);
        return null;
      };

      const gpsLat = toNumber(tags.GPSLatitude);
      const gpsLng = toNumber(tags.GPSLongitude);

      return {
        width: tags.ImageWidth || tags.ExifImageWidth || null,
        height: tags.ImageHeight || tags.ExifImageHeight || null,
        dateTaken: toISOString(tags.DateTimeOriginal) || toISOString(tags.CreateDate) || null,
        cameraMake: tags.Make || null,
        cameraModel: tags.Model || null,
        gps:
          gpsLat !== null && gpsLng !== null
            ? {
                lat: gpsLat,
                lng: gpsLng,
                altitude: toNumber(tags.GPSAltitude) ?? undefined,
              }
            : null,
        rawExif: JSON.stringify(tags, null, 2),
      };
    } catch (error) {
      console.error('[ExifTool] Error extracting metadata:', error);
      throw error;
    }
  }

  /**
   * Wrap a promise with a timeout
   * @param promise - The promise to wrap
   * @param timeoutMs - Timeout in milliseconds
   * @param errorMessage - Error message if timeout occurs
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(errorMessage));
      }, timeoutMs);

      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * Extract binary data for a specific tag (e.g., PreviewImage, ThumbnailImage)
   * Used for extracting embedded JPEG previews from RAW files
   *
   * @param filePath - Absolute path to the image file
   * @param tag - Tag name to extract (e.g., 'PreviewImage', 'JpgFromRaw')
   * @returns Buffer containing binary data, or null if tag doesn't exist
   */
  async extractBinaryTag(filePath: string, tag: string): Promise<Buffer | null> {
    try {
      // exiftool-vendored has extractBinaryTagToBuffer for this purpose
      const buffer = await exiftool.extractBinaryTagToBuffer(tag, filePath);
      return buffer;
    } catch (error) {
      // Tag might not exist or extraction failed
      console.log(`[ExifTool] Could not extract ${tag} from ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Get the EXIF orientation value from a file
   * Returns the orientation string (e.g., 'Rotate 90 CW', 'Horizontal (normal)')
   * or null if not found
   */
  async getOrientation(filePath: string): Promise<string | null> {
    try {
      const tags = await exiftool.read(filePath);
      // Orientation can be a number (1-8) or string description
      const orientation = tags.Orientation;
      if (orientation === undefined || orientation === null) {
        return null;
      }
      // exiftool-vendored returns the string description
      return String(orientation);
    } catch (error) {
      console.log(`[ExifTool] Could not read orientation from ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Close the ExifTool process
   * Should be called when the application is shutting down
   * OPT-007: Added timeout and error handling to prevent shutdown hangs
   */
  async close(): Promise<void> {
    try {
      await Promise.race([
        exiftool.end(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('ExifTool shutdown timeout')), 5000)
        )
      ]);
    } catch (error) {
      // Log but don't throw - we're shutting down anyway
      console.warn('[ExifTool] Shutdown error (ignored):', error);
    }
  }
}
