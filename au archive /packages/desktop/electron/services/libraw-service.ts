import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import os from 'os';

const execFileAsync = promisify(execFile);

/**
 * LibRawService - Full-quality RAW to JPEG conversion using dcraw_emu
 *
 * Purpose: When embedded previews are too small (e.g., DJI DNG files with 960x720
 * embedded previews for 5376x3956 images), render full-quality previews from RAW data.
 *
 * Core Rules:
 * 1. Only use when embedded preview is < 50% of source resolution
 * 2. Use dcraw_emu from LibRaw (installed via Homebrew or bundled)
 * 3. Pipeline: dcraw_emu → TIFF → sharp → JPEG preview
 * 4. Never throw - return null on failure, import must not fail
 * 5. Cache converted previews in .previews/ directory
 */
export class LibRawService {
  private dcrawPath: string | null = null;

  constructor() {
    this.detectDcraw();
  }

  /**
   * Detect dcraw_emu binary location
   * Checks common paths: Homebrew, bundled resources, system PATH
   */
  private async detectDcraw(): Promise<void> {
    const possiblePaths = [
      '/opt/homebrew/bin/dcraw_emu',     // Homebrew Apple Silicon
      '/usr/local/bin/dcraw_emu',         // Homebrew Intel
      '/usr/bin/dcraw_emu',               // System install
      path.join(process.resourcesPath || '', 'bin', 'dcraw_emu'), // Bundled
    ];

    for (const p of possiblePaths) {
      try {
        await fs.access(p);
        this.dcrawPath = p;
        console.log(`[LibRaw] Found dcraw_emu at: ${p}`);
        return;
      } catch {
        // Try next path
      }
    }

    console.log('[LibRaw] dcraw_emu not found - full RAW rendering unavailable');
  }

  /**
   * Check if dcraw_emu is available for RAW processing
   */
  isAvailable(): boolean {
    return this.dcrawPath !== null;
  }

  /**
   * Formats that dcraw_emu can process (RAW camera formats)
   */
  private readonly SUPPORTED_FORMATS = new Set([
    '.dng',  // Adobe DNG (includes DJI drone DNGs)
    '.nef', '.nrw',              // Nikon
    '.cr2', '.cr3', '.crw',      // Canon
    '.arw', '.srf', '.sr2',      // Sony
    '.orf',                       // Olympus
    '.pef',                       // Pentax
    '.rw2',                       // Panasonic
    '.raf',                       // Fujifilm
    '.raw', '.rwl',              // Leica
    '.3fr', '.fff',              // Hasselblad
    '.iiq',                       // Phase One
    '.mrw',                       // Minolta
    '.x3f',                       // Sigma
    '.erf',                       // Epson
    '.mef',                       // Mamiya
    '.mos',                       // Leaf
    '.kdc', '.dcr',              // Kodak
  ]);

  /**
   * Check if file format is supported for RAW processing
   */
  canProcess(filePath: string): boolean {
    if (!this.dcrawPath) return false;
    const ext = path.extname(filePath).toLowerCase();
    return this.SUPPORTED_FORMATS.has(ext);
  }

  /**
   * Check if preview needs full RAW render (embedded preview too small)
   *
   * @param sourceWidth - Original image width from EXIF
   * @param sourceHeight - Original image height from EXIF
   * @param previewWidth - Embedded preview width
   * @param previewHeight - Embedded preview height
   * @param threshold - Minimum percentage of source resolution (default 0.5 = 50%)
   * @returns true if preview is too small and needs full render
   */
  needsFullRender(
    sourceWidth: number,
    sourceHeight: number,
    previewWidth: number,
    previewHeight: number,
    threshold: number = 0.5
  ): boolean {
    if (!sourceWidth || !sourceHeight || !previewWidth || !previewHeight) {
      return false;
    }

    const sourcePixels = sourceWidth * sourceHeight;
    const previewPixels = previewWidth * previewHeight;
    const ratio = previewPixels / sourcePixels;

    const needsRender = ratio < threshold;
    if (needsRender) {
      console.log(`[LibRaw] Preview needs full render: ${previewWidth}x${previewHeight} is only ${(ratio * 100).toFixed(1)}% of ${sourceWidth}x${sourceHeight}`);
    }

    return needsRender;
  }

  /**
   * Render full-quality JPEG preview from RAW file
   *
   * @param sourcePath - Path to RAW file
   * @param outputPath - Path for output JPEG
   * @param maxSize - Maximum dimension for output (default 1920px)
   * @returns true if successful, false on failure
   */
  async renderPreview(
    sourcePath: string,
    outputPath: string,
    maxSize: number = 1920
  ): Promise<boolean> {
    if (!this.dcrawPath) {
      console.log('[LibRaw] dcraw_emu not available');
      return false;
    }

    if (!this.canProcess(sourcePath)) {
      console.log(`[LibRaw] Format not supported: ${sourcePath}`);
      return false;
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'libraw-'));
    const tempTiff = path.join(tempDir, 'output.tiff');

    try {
      console.log(`[LibRaw] Processing RAW: ${sourcePath}`);
      const startTime = Date.now();

      // Run dcraw_emu to convert RAW to TIFF
      // Flags:
      // -T: Output TIFF instead of PPM
      // -w: Use camera white balance
      // -o 1: sRGB color space
      // -q 3: High quality interpolation (AHD)
      // -Z filename: Output to specific file
      await execFileAsync(this.dcrawPath, [
        '-T',           // TIFF output
        '-w',           // Camera white balance
        '-o', '1',      // sRGB
        '-q', '3',      // High quality
        '-Z', tempTiff, // Output path (dcraw_emu uses -Z, not -O)
        sourcePath
      ], {
        timeout: 60000, // 60 second timeout
      });

      console.log(`[LibRaw] dcraw_emu completed in ${Date.now() - startTime}ms`);

      // Check if output was created
      try {
        await fs.access(tempTiff);
      } catch {
        console.error('[LibRaw] dcraw_emu did not produce output');
        return false;
      }

      // Use sharp to resize and convert to JPEG
      const resizeStart = Date.now();
      await sharp(tempTiff)
        .rotate() // Auto-rotate based on EXIF
        .resize(maxSize, maxSize, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({
          quality: 85,
          mozjpeg: true,
        })
        .toFile(outputPath);

      console.log(`[LibRaw] Sharp resize/convert completed in ${Date.now() - resizeStart}ms`);
      console.log(`[LibRaw] Total processing time: ${Date.now() - startTime}ms`);

      return true;
    } catch (error) {
      console.error('[LibRaw] Failed to process RAW:', error);
      return false;
    } finally {
      // Cleanup temp files
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Get preview quality classification based on resolution comparison
   */
  getQualityLevel(
    sourceWidth: number,
    sourceHeight: number,
    previewWidth: number,
    previewHeight: number
  ): 'full' | 'embedded' | 'low' {
    if (!sourceWidth || !sourceHeight || !previewWidth || !previewHeight) {
      return 'embedded';
    }

    const sourcePixels = sourceWidth * sourceHeight;
    const previewPixels = previewWidth * previewHeight;
    const ratio = previewPixels / sourcePixels;

    if (ratio >= 0.8) return 'full';      // 80%+ of source = full quality
    if (ratio >= 0.5) return 'embedded';  // 50-80% = acceptable embedded
    return 'low';                          // <50% = low quality
  }
}
