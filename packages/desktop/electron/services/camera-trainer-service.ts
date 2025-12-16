/**
 * Camera Trainer Service
 *
 * Trains camera signatures from sample video files.
 * Uses a clear priority order for metadata extraction:
 *   1. ExifTool (PRIMARY) - embedded metadata is authoritative
 *   2. FFprobe (SECONDARY) - technical specs + brand fallback
 *   3. XML sidecar (SUPPLEMENTARY) - lens, gamma, serial only
 *
 * Follows KISS principle: reuses existing services, no duplication.
 */

import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { getMediaInfo, getCameraInfo } from './exiftool-service';
import { getVideoInfo } from './ffprobe-service';
import type { Medium } from '@nightfox/core';

// =============================================================================
// TYPES - Clean, single-purpose interfaces
// =============================================================================

/**
 * Camera identity - who made this camera
 */
export interface CameraIdentity {
  make: string | null;
  model: string | null;
  normalizedName: string;
  confidence: 'high' | 'medium' | 'low' | 'none';
  source: 'exif' | 'brand' | 'xml' | 'format' | 'unknown';
}

/**
 * Technical specs - video properties
 */
export interface TechnicalSpecs {
  width: number | null;
  height: number | null;
  frameRate: number | null;
  codec: string | null;
  bitrate: number | null;
}

/**
 * Supplementary info - from XML sidecars only
 */
export interface SupplementaryInfo {
  lens: string | null;
  gamma: string | null;
  serial: string | null;
}

/**
 * Complete file analysis result
 */
export interface FileAnalysis {
  path: string;
  filename: string;
  sidecarPath: string | null;
  identity: CameraIdentity;
  specs: TechnicalSpecs;
  supplementary: SupplementaryInfo;
  error: string | null;
}

/**
 * Training session state
 */
export interface TrainingSession {
  id: string;
  files: FileAnalysis[];
  status: 'collecting' | 'analyzing' | 'ready' | 'error';
  minimumFiles: number;
  error: string | null;
}

/**
 * Final training result
 */
export interface TrainingResult {
  success: boolean;
  identity: CameraIdentity | null;
  specs: TechnicalSpecs | null;
  supplementary: SupplementaryInfo | null;
  suggestedName: string;
  suggestedMedium: Medium;
  signature: Record<string, unknown> | null;
  filesAnalyzed: number;
  errors: string[];
}

// =============================================================================
// MODEL NAME NORMALIZATION - Do this at extraction time, not display time
// =============================================================================

const SONY_MODEL_MAP: Record<string, string> = {
  'ILCE-7SM3': 'A7S III',
  'ILCE-7SM2': 'A7S II',
  'ILCE-7S': 'A7S',
  'ILCE-7M4': 'A7 IV',
  'ILCE-7M3': 'A7 III',
  'ILCE-7M2': 'A7 II',
  'ILCE-7RM5': 'A7R V',
  'ILCE-7RM4': 'A7R IV',
  'ILCE-7RM3': 'A7R III',
  'ILCE-7C': 'A7C',
  'ILCE-7CR': 'A7C R',
  'ILCE-7C2': 'A7C II',
  'ILCE-9M3': 'A9 III',
  'ILCE-9M2': 'A9 II',
  'ILCE-9': 'A9',
  'ILCE-1': 'A1',
  'ILCE-6700': 'A6700',
  'ILCE-6600': 'A6600',
  'ILCE-6500': 'A6500',
  'ILCE-6400': 'A6400',
  'ILCE-6300': 'A6300',
  'ILME-FX3': 'FX3',
  'ILME-FX30': 'FX30',
  'ILME-FX6': 'FX6',
};

/**
 * Normalize camera model name to human-readable form
 * Called at extraction time, not display time
 */
function normalizeModelName(model: string | null, make: string | null): string {
  if (!model) return '';

  const upperModel = model.toUpperCase();

  // Sony model mappings
  for (const [pattern, replacement] of Object.entries(SONY_MODEL_MAP)) {
    if (upperModel === pattern.toUpperCase() || upperModel.includes(pattern.toUpperCase())) {
      return replacement;
    }
  }

  // Canon cleanup
  if (model.startsWith('Canon EOS ')) {
    return model.replace('Canon EOS ', '');
  }

  // Panasonic cleanup
  if (model.startsWith('DC-')) {
    return model.replace('DC-', '');
  }

  return model;
}

/**
 * Extract manufacturer from MajorBrand field
 */
function extractMakeFromBrand(majorBrand: string): string | null {
  const brandLower = majorBrand.toLowerCase();

  if (brandLower.includes('sony') || brandLower.includes('xavc')) return 'Sony';
  if (brandLower.includes('canon') || brandLower.includes('crm')) return 'Canon';
  if (brandLower.includes('panasonic') || brandLower.includes('pana')) return 'Panasonic';
  if (brandLower.includes('nikon') || brandLower.includes('nksc')) return 'Nikon';
  if (brandLower.includes('gopro')) return 'GoPro';
  if (brandLower.includes('dji')) return 'DJI';
  if (brandLower.includes('apple') || brandLower === 'qt') return 'Apple';

  return null;
}

// =============================================================================
// CORE IDENTIFICATION - ExifTool FIRST, FFprobe SECOND, Sidecar THIRD, Format FOURTH
// =============================================================================

/**
 * Identify camera from a single video file
 * Priority: ExifTool > FFprobe brand > Sidecar (XML/MOI) > Format signature
 */
async function identifyCamera(
  videoPath: string,
  sidecarPath: string | null
): Promise<{ identity: CameraIdentity; specs: TechnicalSpecs; supplementary: SupplementaryInfo }> {
  let make: string | null = null;
  let model: string | null = null;
  let source: CameraIdentity['source'] = 'unknown';
  let confidence: CameraIdentity['confidence'] = 'none';

  // Initialize specs and supplementary
  const specs: TechnicalSpecs = {
    width: null,
    height: null,
    frameRate: null,
    codec: null,
    bitrate: null,
  };

  const supplementary: SupplementaryInfo = {
    lens: null,
    gamma: null,
    serial: null,
  };

  // ==========================================================================
  // 1. EXIFTOOL (PRIMARY) - Embedded metadata is authoritative
  // ==========================================================================
  try {
    const exifInfo = await getMediaInfo(videoPath);

    if (exifInfo.make) {
      make = exifInfo.make;
      source = 'exif';
    }
    if (exifInfo.model) {
      model = exifInfo.model;
    }

    // Get specs from ExifTool
    specs.width = exifInfo.width;
    specs.height = exifInfo.height;
    specs.frameRate = exifInfo.frameRate;

    // If we got make AND model from ExifTool, high confidence
    if (make && model) {
      confidence = 'high';
    }

    // Try brand fallback from ExifTool's MajorBrand
    if (!make && exifInfo.majorBrand) {
      const brandMake = extractMakeFromBrand(exifInfo.majorBrand);
      if (brandMake) {
        make = brandMake;
        source = 'brand';
        confidence = model ? 'medium' : 'low';
      }
    }
  } catch (err) {
    console.warn('[CameraTrainer] ExifTool failed:', err);
  }

  // ==========================================================================
  // 2. FFPROBE (SECONDARY) - Technical specs + brand fallback
  // ==========================================================================
  try {
    const ffInfo = await getVideoInfo(videoPath);

    // Fill in missing specs from FFprobe
    if (!specs.width) specs.width = ffInfo.width || null;
    if (!specs.height) specs.height = ffInfo.height || null;
    if (!specs.frameRate) specs.frameRate = ffInfo.frameRate || null;
    specs.codec = ffInfo.codec || null;
    specs.bitrate = ffInfo.bitrate;

    // Brand fallback from FFprobe's major_brand (only if no make yet)
    if (!make && ffInfo.majorBrand) {
      const brandMake = extractMakeFromBrand(ffInfo.majorBrand);
      if (brandMake) {
        make = brandMake;
        source = 'brand';
        confidence = 'low';
      }
    }
  } catch (err) {
    console.warn('[CameraTrainer] FFprobe failed:', err);
  }

  // ==========================================================================
  // 3. SIDECAR FILES (SUPPLEMENTARY) - XML (Sony) or MOI (JVC)
  //    Does NOT override make/model from ExifTool
  // ==========================================================================
  if (sidecarPath) {
    const sidecarExt = path.extname(sidecarPath).toLowerCase();

    if (sidecarExt === '.moi') {
      // JVC MOI sidecar - limited metadata but confirms JVC format
      try {
        const moiData = parseMoiSidecar(sidecarPath);
        // MOI files don't have make/model, but presence confirms JVC
        // Format-based detection will handle the identification
        if (moiData.version) {
          console.log(`[CameraTrainer] JVC MOI version: ${moiData.version}`);
        }
      } catch (err) {
        console.warn('[CameraTrainer] MOI sidecar parse failed:', err);
      }
    } else {
      // XML sidecar (Sony NonRealTimeMeta or similar)
      try {
        const xmlData = parseSidecarXml(sidecarPath);

        // Only use for supplementary info
        supplementary.lens = xmlData.lens;
        supplementary.gamma = xmlData.gamma;
        supplementary.serial = xmlData.serial;

        // ONLY use XML make/model if we have NOTHING from ExifTool
        if (!make && xmlData.manufacturer) {
          make = xmlData.manufacturer;
          source = 'xml';
          confidence = model ? 'medium' : 'low';
        }
        if (!model && xmlData.modelName) {
          model = xmlData.modelName;
          if (make) confidence = 'medium';
        }
      } catch (err) {
        console.warn('[CameraTrainer] XML sidecar parse failed:', err);
      }
    }
  }

  // ==========================================================================
  // 4. FORMAT-BASED IDENTIFICATION - Last resort using file signatures
  //    Only used when metadata extraction fails completely
  // ==========================================================================
  if (!make && confidence === 'none') {
    const formatMatch = identifyFromFormat(videoPath, sidecarPath);
    if (formatMatch) {
      make = formatMatch.make;
      model = formatMatch.model;
      source = 'format' as CameraIdentity['source'];
      confidence = formatMatch.confidence;
      console.log(`[CameraTrainer] Format-based identification: ${formatMatch.displayName}`);
    }
  }

  // ==========================================================================
  // BUILD IDENTITY - Normalize name at extraction time
  // ==========================================================================
  const normalizedModel = normalizeModelName(model, make);
  const normalizedName = make && normalizedModel
    ? `${make} ${normalizedModel}`
    : make || normalizedModel || '';

  const identity: CameraIdentity = {
    make,
    model,
    normalizedName,
    confidence,
    source,
  };

  return { identity, specs, supplementary };
}

// =============================================================================
// XML SIDECAR PARSING - Sony NonRealTimeMeta format
// =============================================================================

interface SidecarData {
  manufacturer: string | null;
  modelName: string | null;
  serial: string | null;
  lens: string | null;
  gamma: string | null;
}

/**
 * Parse Sony NonRealTimeMeta XML sidecar
 */
function parseSidecarXml(xmlPath: string): SidecarData {
  const content = fs.readFileSync(xmlPath, 'utf-8');

  const result: SidecarData = {
    manufacturer: null,
    modelName: null,
    serial: null,
    lens: null,
    gamma: null,
  };

  // <Device manufacturer="Sony" modelName="ILCE-7SM3" serialNo="..."/>
  const deviceMatch = content.match(/<Device\s+([^>]+)\/>/i);
  if (deviceMatch) {
    const attrs = deviceMatch[1];
    result.manufacturer = extractXmlAttr(attrs, 'manufacturer');
    result.modelName = extractXmlAttr(attrs, 'modelName');
    result.serial = extractXmlAttr(attrs, 'serialNo');
  }

  // <Lens modelName="FE 55mm F1.8 ZA"/>
  const lensMatch = content.match(/<Lens\s+([^>]+)\/>/i);
  if (lensMatch) {
    result.lens = extractXmlAttr(lensMatch[1], 'modelName');
  }

  // <Item name="CaptureGammaEquation" value="s-log3-cine"/>
  const gammaMatch = content.match(/<Item\s+name="CaptureGammaEquation"\s+value="([^"]+)"/i);
  if (gammaMatch) {
    result.gamma = gammaMatch[1];
  }

  return result;
}

/**
 * Extract attribute value from XML attribute string
 */
function extractXmlAttr(attrString: string, attrName: string): string | null {
  const regex = new RegExp(`${attrName}="([^"]*)"`, 'i');
  const match = attrString.match(regex);
  return match ? match[1] : null;
}

// =============================================================================
// SESSION MANAGEMENT
// =============================================================================

const MINIMUM_FILES = 3;
let currentSession: TrainingSession | null = null;

/**
 * Start a new training session
 */
export function startTrainingSession(): TrainingSession {
  currentSession = {
    id: Date.now().toString(),
    files: [],
    status: 'collecting',
    minimumFiles: MINIMUM_FILES,
    error: null,
  };
  return currentSession;
}

/**
 * Get current training session
 */
export function getTrainingSession(): TrainingSession | null {
  return currentSession;
}

/**
 * Cancel current training session
 */
export function cancelTrainingSession(): void {
  currentSession = null;
}

/**
 * Add files to training session
 */
export async function addTrainingFiles(
  paths: string[]
): Promise<{ added: number; total: number; minimumMet: boolean; errors: string[] }> {
  if (!currentSession) {
    throw new Error('No active training session');
  }

  const errors: string[] = [];
  let added = 0;

  for (const inputPath of paths) {
    try {
      const stat = fs.statSync(inputPath);

      if (stat.isDirectory()) {
        const allFiles = findAllMediaFiles(inputPath);
        for (const filePath of allFiles.videoFiles) {
          if (!currentSession.files.some((f) => f.path === filePath)) {
            const sidecar = findSidecarFile(filePath, allFiles.sidecarFiles);
            currentSession.files.push({
              path: filePath,
              filename: path.basename(filePath),
              sidecarPath: sidecar,
              identity: { make: null, model: null, normalizedName: '', confidence: 'none', source: 'unknown' },
              specs: { width: null, height: null, frameRate: null, codec: null, bitrate: null },
              supplementary: { lens: null, gamma: null, serial: null },
              error: null,
            });
            added++;
          }
        }
      } else if (isVideoFile(inputPath)) {
        if (!currentSession.files.some((f) => f.path === inputPath)) {
          const dir = path.dirname(inputPath);
          const sidecars = findSidecarFilesInDir(dir);
          const sidecar = findSidecarFile(inputPath, sidecars);
          currentSession.files.push({
            path: inputPath,
            filename: path.basename(inputPath),
            sidecarPath: sidecar,
            identity: { make: null, model: null, normalizedName: '', confidence: 'none', source: 'unknown' },
            specs: { width: null, height: null, frameRate: null, codec: null, bitrate: null },
            supplementary: { lens: null, gamma: null, serial: null },
            error: null,
          });
          added++;
        }
      } else {
        errors.push(`Skipped non-video file: ${path.basename(inputPath)}`);
      }
    } catch (err) {
      errors.push(`Error processing ${inputPath}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  return {
    added,
    total: currentSession.files.length,
    minimumMet: currentSession.files.length >= MINIMUM_FILES,
    errors,
  };
}

/**
 * Remove file from training session
 */
export function removeTrainingFile(filePath: string): void {
  if (!currentSession) return;
  currentSession.files = currentSession.files.filter((f) => f.path !== filePath);
}

/**
 * Analyze all training files and generate result
 */
export async function analyzeTrainingFiles(): Promise<TrainingResult> {
  if (!currentSession) {
    return createErrorResult(['No active training session']);
  }

  if (currentSession.files.length < MINIMUM_FILES) {
    return createErrorResult([`Need at least ${MINIMUM_FILES} files (have ${currentSession.files.length})`]);
  }

  currentSession.status = 'analyzing';
  const errors: string[] = [];

  // Analyze each file
  for (const file of currentSession.files) {
    try {
      const result = await identifyCamera(file.path, file.sidecarPath);
      file.identity = result.identity;
      file.specs = result.specs;
      file.supplementary = result.supplementary;

      // Log first file for debugging
      if (currentSession.files.indexOf(file) === 0) {
        console.log('[CameraTrainer] First file analysis:', {
          path: file.path,
          sidecar: file.sidecarPath,
          identity: file.identity,
          specs: file.specs,
          supplementary: file.supplementary,
        });
      }
    } catch (error) {
      file.error = error instanceof Error ? error.message : 'Analysis failed';
      errors.push(`${file.filename}: ${file.error}`);
    }
  }

  // Aggregate results from all files
  const aggregated = aggregateResults(currentSession.files);

  if (aggregated.identity.confidence === 'none') {
    currentSession.status = 'error';
    currentSession.error = 'Could not identify camera from files';
    return createErrorResult(['Could not identify camera - no make/model found in any file']);
  }

  // Generate suggestions
  const suggestedName = aggregated.identity.normalizedName || 'Unknown Camera';
  const suggestedMedium = detectMedium(aggregated);

  // Build signature
  const signature = buildSignature(aggregated, suggestedName, suggestedMedium);

  currentSession.status = 'ready';

  return {
    success: true,
    identity: aggregated.identity,
    specs: aggregated.specs,
    supplementary: aggregated.supplementary,
    suggestedName,
    suggestedMedium,
    signature,
    filesAnalyzed: currentSession.files.filter((f) => !f.error).length,
    errors,
  };
}

/**
 * Create error result
 */
function createErrorResult(errors: string[]): TrainingResult {
  return {
    success: false,
    identity: null,
    specs: null,
    supplementary: null,
    suggestedName: '',
    suggestedMedium: 'modern',
    signature: null,
    filesAnalyzed: 0,
    errors,
  };
}

/**
 * Aggregate results from multiple files - find consensus
 */
function aggregateResults(files: FileAnalysis[]): {
  identity: CameraIdentity;
  specs: TechnicalSpecs;
  supplementary: SupplementaryInfo;
} {
  const validFiles = files.filter((f) => !f.error);

  // Find most common make/model
  const makes = validFiles.map((f) => f.identity.make).filter((m): m is string => m !== null);
  const models = validFiles.map((f) => f.identity.model).filter((m): m is string => m !== null);
  const sources = validFiles.map((f) => f.identity.source);

  const make = findMostCommon(makes);
  const model = findMostCommon(models);
  const source = findMostCommon(sources.filter((s) => s !== 'unknown')) as CameraIdentity['source'] || 'unknown';

  // Calculate confidence based on consistency
  let confidence: CameraIdentity['confidence'] = 'none';
  if (make && model) {
    const makeConsistency = makes.filter((m) => m === make).length / validFiles.length;
    const modelConsistency = models.filter((m) => m === model).length / validFiles.length;
    if (makeConsistency >= 0.8 && modelConsistency >= 0.8) {
      confidence = source === 'exif' ? 'high' : 'medium';
    } else if (makeConsistency >= 0.5 || modelConsistency >= 0.5) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }
  } else if (make || model) {
    confidence = 'low';
  }

  const normalizedModel = normalizeModelName(model, make);
  const normalizedName = make && normalizedModel
    ? `${make} ${normalizedModel}`
    : make || normalizedModel || '';

  // Average specs
  const widths = validFiles.map((f) => f.specs.width).filter((w): w is number => w !== null);
  const heights = validFiles.map((f) => f.specs.height).filter((h): h is number => h !== null);
  const frameRates = validFiles.map((f) => f.specs.frameRate).filter((r): r is number => r !== null);
  const codecs = validFiles.map((f) => f.specs.codec).filter((c): c is string => c !== null);

  // Most common supplementary info
  const lenses = validFiles.map((f) => f.supplementary.lens).filter((l): l is string => l !== null);
  const gammas = validFiles.map((f) => f.supplementary.gamma).filter((g): g is string => g !== null);

  return {
    identity: {
      make,
      model,
      normalizedName,
      confidence,
      source,
    },
    specs: {
      width: widths.length > 0 ? Math.round(average(widths)) : null,
      height: heights.length > 0 ? Math.round(average(heights)) : null,
      frameRate: frameRates.length > 0 ? Math.round(average(frameRates) * 100) / 100 : null,
      codec: findMostCommon(codecs),
      bitrate: null,
    },
    supplementary: {
      lens: findMostCommon(lenses),
      gamma: findMostCommon(gammas),
      serial: null,
    },
  };
}

/**
 * Find most common value in array
 */
function findMostCommon<T>(values: T[]): T | null {
  if (values.length === 0) return null;

  const counts = new Map<T, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) || 0) + 1);
  }

  let maxCount = 0;
  let maxValue: T | null = null;
  for (const [value, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      maxValue = value;
    }
  }

  return maxValue;
}

/**
 * Calculate average
 */
function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// =============================================================================
// CLASSIFICATION
// =============================================================================

/**
 * Detect medium type
 */
function detectMedium(result: { identity: CameraIdentity; specs: TechnicalSpecs }): Medium {
  const { specs, identity } = result;

  // SD resolution = dadcam
  if (specs.width && specs.width < 1280) return 'dadcam';

  // Known dadcam models
  const model = (identity.model || '').toLowerCase();
  const dadcamIndicators = ['handycam', 'dcr-', 'hdr-cx', 'hdr-sr', 'vixia', 'legria', 'everio'];
  if (dadcamIndicators.some((ind) => model.includes(ind))) return 'dadcam';

  return 'modern';
}

// =============================================================================
// SIGNATURE BUILDING
// =============================================================================

/**
 * Build camera signature for storage
 */
function buildSignature(
  result: { identity: CameraIdentity; specs: TechnicalSpecs; supplementary: SupplementaryInfo },
  name: string,
  medium: Medium
): Record<string, unknown> {
  const { identity, specs, supplementary } = result;

  // Generate stable UUID
  const hashInput = `${identity.make || 'unknown'}|${identity.model || name}`.toLowerCase();
  const hash = crypto.createHash('md5').update(hashInput).digest('hex');
  const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;

  return {
    id,
    make: identity.make || 'Unknown',
    model: identity.model || name,
    displayName: identity.normalizedName || name,
    medium,
    confidence: identity.confidence,
    source: identity.source,
    serialNumber: supplementary.serial,
    colorProfile: supplementary.gamma,
    technical: {
      resolution: specs.width && specs.height ? `${specs.width}x${specs.height}` : null,
      frameRate: specs.frameRate,
      codec: specs.codec,
    },
    supplementary: {
      lens: supplementary.lens,
      gamma: supplementary.gamma,
    },
    processing: {
      deinterlace: medium === 'dadcam',
      suggestedLut: supplementary.gamma === 's-log3-cine' ? 'Sony S-Log3 to Rec.709' : null,
    },
    metadata: {
      source: 'user-trained',
      verified: false,
    },
  };
}

// =============================================================================
// FILE DISCOVERY
// =============================================================================

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.mts', '.m2ts', '.avi', '.mkv', '.mxf', '.mpg', '.mpeg', '.r3d', '.braw', '.tod', '.mod', '.3gp', '.webm', '.wmv', '.flv', '.m4v', '.vob', '.dv'];
const SIDECAR_EXTENSIONS = ['.xml', '.xmp', '.thm', '.moi'];  // MOI = JVC metadata sidecar

// =============================================================================
// FORMAT-BASED IDENTIFICATION - When metadata is missing, use file signatures
// =============================================================================

interface FormatSignature {
  make: string;
  model: string | null;
  displayName: string;
  extensions: string[];
  sidecarExt: string | null;
  folderPattern: RegExp | null;
  confidence: 'medium' | 'low';
}

/**
 * Known format signatures for cameras that don't embed metadata
 */
const FORMAT_SIGNATURES: FormatSignature[] = [
  {
    // JVC Everio HD (2006-2010 era) - TOD format with MOI sidecars
    make: 'JVC',
    model: 'Everio HD',
    displayName: 'JVC Everio HD',
    extensions: ['.tod'],
    sidecarExt: '.moi',
    folderPattern: /^PRG\d{3}$/i,
    confidence: 'medium',
  },
  {
    // JVC Everio SD - MOD format (older standard def)
    make: 'JVC',
    model: 'Everio',
    displayName: 'JVC Everio',
    extensions: ['.mod'],
    sidecarExt: '.moi',
    folderPattern: /^PRG\d{3}$/i,
    confidence: 'medium',
  },
  {
    // Panasonic AVCHD camcorders
    make: 'Panasonic',
    model: null,
    displayName: 'Panasonic AVCHD',
    extensions: ['.mts', '.m2ts'],
    sidecarExt: null,
    folderPattern: /^(PRIVATE|AVCHD|BDMV)$/i,
    confidence: 'low',
  },
];

/**
 * Identify camera from file format when metadata is missing
 * Uses extension, sidecar presence, and folder structure
 */
function identifyFromFormat(
  videoPath: string,
  sidecarPath: string | null
): { make: string; model: string | null; displayName: string; confidence: 'medium' | 'low' } | null {
  const ext = path.extname(videoPath).toLowerCase();
  const parentFolder = path.basename(path.dirname(videoPath));
  const sidecarExt = sidecarPath ? path.extname(sidecarPath).toLowerCase() : null;

  for (const sig of FORMAT_SIGNATURES) {
    // Check extension match
    if (!sig.extensions.includes(ext)) continue;

    // Check sidecar match (if signature requires it)
    if (sig.sidecarExt && sidecarExt !== sig.sidecarExt) continue;

    // Check folder pattern (if signature has one)
    if (sig.folderPattern && !sig.folderPattern.test(parentFolder)) {
      // Folder doesn't match but extension does - still a weak match
      if (sig.sidecarExt && sidecarExt === sig.sidecarExt) {
        // Extension + sidecar match = good enough
        return {
          make: sig.make,
          model: sig.model,
          displayName: sig.displayName,
          confidence: 'low',
        };
      }
      continue;
    }

    // Full match
    return {
      make: sig.make,
      model: sig.model,
      displayName: sig.displayName,
      confidence: sig.confidence,
    };
  }

  return null;
}

/**
 * Parse JVC MOI sidecar file for any useful metadata
 * MOI format is mostly timing/duration but has version info
 */
function parseMoiSidecar(moiPath: string): { version: string | null; duration: number | null } {
  try {
    const buffer = fs.readFileSync(moiPath);

    // First 2 bytes are version string (e.g., "V6", "V7")
    const version = buffer.slice(0, 2).toString('ascii');

    // Bytes 4-7 contain date info (year at bytes 6-7 as uint16 BE)
    // This isn't super useful but confirms JVC format

    return {
      version: version.startsWith('V') ? version : null,
      duration: null, // Duration is complex to parse from MOI
    };
  } catch {
    return { version: null, duration: null };
  }
}

function isVideoFile(filePath: string): boolean {
  return VIDEO_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

function isSidecarFile(filePath: string): boolean {
  return SIDECAR_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

function findAllMediaFiles(dirPath: string, maxDepth = 5): { videoFiles: string[]; sidecarFiles: string[] } {
  const videoFiles: string[] = [];
  const sidecarFiles: string[] = [];

  function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          walk(fullPath, depth + 1);
        } else if (entry.isFile()) {
          if (isVideoFile(entry.name)) videoFiles.push(fullPath);
          else if (isSidecarFile(entry.name)) sidecarFiles.push(fullPath);
        }
      }
    } catch {
      // Ignore permission errors
    }
  }

  walk(dirPath, 0);
  return { videoFiles, sidecarFiles };
}

function findSidecarFilesInDir(dirPath: string): string[] {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && isSidecarFile(e.name)).map((e) => path.join(dirPath, e.name));
  } catch {
    return [];
  }
}

/**
 * Find matching sidecar for a video file
 * Sony: C4212.MP4 -> C4212M01.XML
 * Canon: MVI_1234.MP4 -> MVI_1234.XMP
 */
function findSidecarFile(videoPath: string, sidecarFiles: string[]): string | null {
  const videoBase = path.basename(videoPath).replace(/\.[^.]+$/, '');
  const videoDir = path.dirname(videoPath);

  for (const sidecar of sidecarFiles) {
    if (!sidecar.startsWith(videoDir)) continue;

    const sidecarBase = path.basename(sidecar).replace(/\.[^.]+$/, '');

    // Exact match
    if (sidecarBase === videoBase) return sidecar;

    // Sony pattern (C4212.MP4 -> C4212M01.XML)
    if (sidecarBase.startsWith(videoBase) && sidecarBase.match(/M\d+$/)) return sidecar;
  }

  return null;
}

/**
 * Export signature to JSON
 */
export function exportSignatureJson(signature: Record<string, unknown>): string {
  return JSON.stringify(signature, null, 2);
}
