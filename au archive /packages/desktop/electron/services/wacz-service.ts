/**
 * WACZ Service - OPT-121
 *
 * Converts WARC files to WACZ (Web Archive Collection Zipped) format.
 * WACZ is the industry standard from Webrecorder, compatible with ReplayWeb.page.
 *
 * @see https://specs.webrecorder.net/wacz/1.1.1/
 * @see https://github.com/webrecorder/wacz-format
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { createGzip } from 'zlib';
import archiver from 'archiver';

// =============================================================================
// Types
// =============================================================================

export interface WACZMetadata {
  title?: string;
  description?: string;
  url?: string;
  ts?: string; // ISO8601 timestamp
  software?: string;
}

export interface WACZResult {
  success: boolean;
  path?: string;
  size?: number;
  error?: string;
}

// =============================================================================
// WACZ Generation
// =============================================================================

/**
 * Convert a WARC file to WACZ format
 *
 * WACZ structure:
 * - archive/data.warc.gz - The compressed WARC file
 * - indexes/index.cdx.gz - CDX index for fast lookup
 * - pages/pages.jsonl - Page list (optional)
 * - datapackage.json - Frictionless Data package descriptor
 * - datapackage-digest.json - SHA256 of datapackage.json
 *
 * @param warcPath - Path to the source WARC file
 * @param outputPath - Path for the output WACZ file
 * @param metadata - Optional metadata for the archive
 */
export async function convertToWACZ(
  warcPath: string,
  outputPath: string,
  metadata?: WACZMetadata
): Promise<WACZResult> {
  try {
    // Verify WARC exists
    if (!fs.existsSync(warcPath)) {
      return { success: false, error: `WARC file not found: ${warcPath}` };
    }

    // Read WARC file
    const warcContent = await fs.promises.readFile(warcPath);
    const warcSize = warcContent.length;

    // Calculate hash
    const warcHash = crypto.createHash('sha256').update(warcContent).digest('hex');

    // Determine if WARC is already gzipped
    const isGzipped = warcPath.endsWith('.warc.gz');
    const archiveFilename = isGzipped ? 'data.warc.gz' : 'data.warc';

    // Create WACZ as a ZIP file
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    // Track completion
    const archiveComplete = new Promise<void>((resolve, reject) => {
      output.on('close', resolve);
      archive.on('error', reject);
    });

    archive.pipe(output);

    // Add WARC file to archive/ directory
    if (isGzipped) {
      archive.append(warcContent, { name: `archive/${archiveFilename}` });
    } else {
      // Compress the WARC if not already compressed
      const gzippedWarc = await gzipBuffer(warcContent);
      archive.append(gzippedWarc, { name: 'archive/data.warc.gz' });
    }

    // Create minimal CDX index (simplified - real CDX requires parsing WARC records)
    // For now, create a placeholder that indicates the archive contains content
    const cdxContent = createMinimalCDX(metadata?.url || 'unknown', metadata?.ts || new Date().toISOString());
    const gzippedCdx = await gzipBuffer(Buffer.from(cdxContent, 'utf-8'));
    archive.append(gzippedCdx, { name: 'indexes/index.cdx.gz' });

    // Create pages.jsonl (list of pages in the archive)
    const pagesContent = createPagesJsonl(metadata);
    archive.append(pagesContent, { name: 'pages/pages.jsonl' });

    // Create datapackage.json (Frictionless Data package descriptor)
    const datapackage = createDatapackage(metadata, warcHash, warcSize, isGzipped);
    const datapackageJson = JSON.stringify(datapackage, null, 2);
    archive.append(datapackageJson, { name: 'datapackage.json' });

    // Create datapackage-digest.json
    const datapackageHash = crypto.createHash('sha256').update(datapackageJson).digest('hex');
    const digestJson = JSON.stringify({
      path: 'datapackage.json',
      hash: `sha256:${datapackageHash}`,
    });
    archive.append(digestJson, { name: 'datapackage-digest.json' });

    // Finalize archive
    await archive.finalize();
    await archiveComplete;

    // Get output file size
    const stats = await fs.promises.stat(outputPath);

    console.log(`[WACZ] Created ${outputPath} (${formatBytes(stats.size)})`);

    return {
      success: true,
      path: outputPath,
      size: stats.size,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[WACZ] Conversion failed: ${errorMessage}`);
    return { success: false, error: errorMessage };
  }
}

/**
 * Create a minimal CDX index entry
 * Real CDX requires parsing WARC records - this is a simplified version
 */
function createMinimalCDX(url: string, timestamp: string): string {
  // CDX format: urlkey timestamp original mime status checksum redirect meta length offset filename
  // We use CDXJ format (JSON) which is more flexible
  const ts = timestamp.replace(/[-:TZ]/g, '').substring(0, 14); // YYYYMMDDHHmmss
  const urlKey = url.replace(/^https?:\/\//, '').replace(/\/$/, '');

  return JSON.stringify({
    urlkey: urlKey,
    timestamp: ts,
    url: url,
    mime: 'text/html',
    status: '200',
    digest: '-',
    length: '-',
    offset: '0',
    filename: 'data.warc.gz',
  }) + '\n';
}

/**
 * Create pages.jsonl content
 */
function createPagesJsonl(metadata?: WACZMetadata): string {
  const pages = [{
    url: metadata?.url || 'unknown',
    title: metadata?.title || 'Archived Page',
    ts: metadata?.ts || new Date().toISOString(),
    text: metadata?.description || '',
  }];

  return pages.map(p => JSON.stringify(p)).join('\n') + '\n';
}

/**
 * Create datapackage.json (Frictionless Data package descriptor)
 */
function createDatapackage(
  metadata: WACZMetadata | undefined,
  warcHash: string,
  warcSize: number,
  isGzipped: boolean
): Record<string, unknown> {
  const now = new Date().toISOString();

  return {
    profile: 'data-package',
    title: metadata?.title || 'Web Archive',
    description: metadata?.description || '',
    created: now,
    modified: now,
    software: metadata?.software || 'AU Archive',
    mainPageUrl: metadata?.url,
    mainPageDate: metadata?.ts || now,
    wacz_version: '1.1.1',
    resources: [
      {
        name: 'data.warc.gz',
        path: 'archive/data.warc.gz',
        hash: `sha256:${warcHash}`,
        bytes: warcSize,
      },
      {
        name: 'index.cdx.gz',
        path: 'indexes/index.cdx.gz',
      },
      {
        name: 'pages.jsonl',
        path: 'pages/pages.jsonl',
      },
    ],
  };
}

/**
 * Gzip a buffer
 */
function gzipBuffer(buffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const gzip = createGzip();

    gzip.on('data', (chunk: Buffer) => chunks.push(chunk));
    gzip.on('end', () => resolve(Buffer.concat(chunks)));
    gzip.on('error', reject);

    gzip.write(buffer);
    gzip.end();
  });
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// =============================================================================
// Auto-Conversion Integration
// =============================================================================

/**
 * Auto-convert a WARC to WACZ after capture
 * Called by the orchestrator after successful WARC generation
 */
export async function autoConvertToWACZ(
  warcPath: string,
  metadata?: WACZMetadata
): Promise<WACZResult> {
  // Generate output path by replacing extension
  const waczPath = warcPath.replace(/\.warc(\.gz)?$/, '.wacz');

  // Skip if WACZ already exists
  if (fs.existsSync(waczPath)) {
    console.log(`[WACZ] Already exists: ${waczPath}`);
    return {
      success: true,
      path: waczPath,
      size: (await fs.promises.stat(waczPath)).size,
    };
  }

  return convertToWACZ(warcPath, waczPath, metadata);
}
