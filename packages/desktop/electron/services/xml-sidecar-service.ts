/**
 * XML Sidecar Service
 *
 * Parses XML sidecar files from professional cameras (Sony, Canon, etc.)
 * and extracts camera metadata for linking to video files.
 *
 * Supported formats:
 * - Sony XDCAM (.XML alongside .MXF/.MP4)
 * - Canon XF (.XML alongside .MXF/.MP4)
 * - ARRI (.XML metadata files)
 * - Generic XML metadata
 *
 * @module services/xml-sidecar-service
 */

import { promises as fs } from 'fs';
import path from 'path';
import { parseStringPromise } from 'xml2js';

/**
 * Parsed XML sidecar data
 */
export interface XmlSidecarData {
  /** Original XML file path */
  filePath: string;
  /** Associated video file path (if found) */
  linkedVideoPath: string | null;
  /** XML format type */
  format: 'sony_xdcam' | 'canon_xf' | 'arri' | 'fcpxml' | 'generic';
  /** Camera make from XML */
  make: string | null;
  /** Camera model from XML */
  model: string | null;
  /** Lens info */
  lens: string | null;
  /** Recording date/time */
  recordedAt: string | null;
  /** Duration in seconds */
  duration: number | null;
  /** Frame rate */
  frameRate: number | null;
  /** Resolution */
  width: number | null;
  height: number | null;
  /** Codec info */
  codec: string | null;
  /** Timecode */
  timecode: string | null;
  /** Reel/clip name */
  reelName: string | null;
  /** Scene/take info */
  scene: string | null;
  take: string | null;
  /** Shooting notes */
  notes: string | null;
  /** Raw parsed XML object */
  rawXml: object;
}

/**
 * Check if a file is an XML sidecar
 */
export function isXmlSidecar(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ['.xml', '.xmp', '.fcpxml'].includes(ext);
}

/**
 * Find the associated video file for an XML sidecar
 * XML sidecars typically have the same base name as the video file
 */
export async function findLinkedVideoFile(xmlPath: string): Promise<string | null> {
  const dir = path.dirname(xmlPath);
  const baseName = path.basename(xmlPath, path.extname(xmlPath));

  // Common video extensions to check
  const videoExtensions = [
    '.mxf', '.MXF',
    '.mp4', '.MP4',
    '.mov', '.MOV',
    '.mts', '.MTS',
    '.m2ts', '.M2TS',
    '.avi', '.AVI',
    '.mkv', '.MKV',
  ];

  for (const ext of videoExtensions) {
    const videoPath = path.join(dir, baseName + ext);
    try {
      await fs.access(videoPath);
      return videoPath;
    } catch {
      // File doesn't exist, try next extension
    }
  }

  // Try removing common suffixes (e.g., _metadata.xml -> basefile.mp4)
  const suffixPatterns = ['_metadata', '_meta', '_info', 'M01', 'M02'];
  for (const suffix of suffixPatterns) {
    if (baseName.endsWith(suffix)) {
      const strippedBase = baseName.slice(0, -suffix.length);
      for (const ext of videoExtensions) {
        const videoPath = path.join(dir, strippedBase + ext);
        try {
          await fs.access(videoPath);
          return videoPath;
        } catch {
          // Continue checking
        }
      }
    }
  }

  return null;
}

/**
 * Detect XML format type
 */
function detectXmlFormat(xml: any): XmlSidecarData['format'] {
  // Sony XDCAM format detection
  if (xml.NonRealTimeMeta || xml.ClipMetadata?.Device?.Manufacturer === 'Sony') {
    return 'sony_xdcam';
  }

  // Canon XF format detection
  if (xml.ClipMetadata?.Device?.Manufacturer === 'Canon' || xml.CanonClip) {
    return 'canon_xf';
  }

  // ARRI format detection
  if (xml.ArrihdrMetaData || xml.ArriMetaData) {
    return 'arri';
  }

  // FCP XML
  if (xml.fcpxml || xml['xmeml']) {
    return 'fcpxml';
  }

  return 'generic';
}

/**
 * Parse Sony XDCAM XML
 */
function parseSonyXdcam(xml: any): Partial<XmlSidecarData> {
  const result: Partial<XmlSidecarData> = {
    format: 'sony_xdcam',
  };

  try {
    // NonRealTimeMeta format (common for Sony)
    const meta = xml.NonRealTimeMeta;
    if (meta) {
      // Camera info
      const device = meta.Device?.[0];
      if (device) {
        result.make = device.Manufacturer?.[0] || 'Sony';
        result.model = device.ModelName?.[0] || device.Serial?.[0] || null;
      }

      // Duration
      const duration = meta.Duration?.[0]?.['$']?.value;
      if (duration) {
        // Parse duration from "value" attribute (e.g., "1800" frames at 30fps)
        result.duration = parseFloat(duration) / 30; // Assume 30fps if not specified
      }

      // Recording date
      const creationDate = meta.CreationDate?.[0]?.['$']?.value;
      if (creationDate) {
        result.recordedAt = creationDate;
      }

      // Video format
      const videoFormat = meta.VideoFormat?.[0]?.VideoLayout?.[0]?.['$'];
      if (videoFormat) {
        result.width = parseInt(videoFormat.pixel, 10) || null;
        result.height = parseInt(videoFormat.numOfVerticalLine, 10) || null;
        result.codec = videoFormat.videoCodec || null;
      }

      // Timecode
      const ltc = meta.LtcChangeTable?.[0]?.LtcChange?.[0]?.['$'];
      if (ltc?.value) {
        result.timecode = ltc.value;
      }
    }

    // ClipMetadata format (alternative Sony format)
    const clipMeta = xml.ClipMetadata;
    if (clipMeta) {
      const device = clipMeta.Device?.[0];
      if (device) {
        result.make = device.Manufacturer?.[0] || result.make || 'Sony';
        result.model = device.ModelName?.[0] || result.model;
      }

      const lens = clipMeta.Lens?.[0];
      if (lens) {
        result.lens = lens.ModelName?.[0] || lens.SerialNumber?.[0] || null;
      }
    }
  } catch (e) {
    console.warn('[XmlSidecarService] Error parsing Sony XDCAM:', e);
  }

  return result;
}

/**
 * Parse Canon XF XML
 */
function parseCanonXf(xml: any): Partial<XmlSidecarData> {
  const result: Partial<XmlSidecarData> = {
    format: 'canon_xf',
  };

  try {
    const clipMeta = xml.ClipMetadata || xml.CanonClip;
    if (clipMeta) {
      const device = clipMeta.Device?.[0];
      if (device) {
        result.make = device.Manufacturer?.[0] || 'Canon';
        result.model = device.ModelName?.[0] || null;
      }

      // Lens info
      const lens = clipMeta.Lens?.[0];
      if (lens) {
        result.lens = lens.ModelName?.[0] || null;
      }

      // Recording info
      const recordInfo = clipMeta.RecordInfo?.[0];
      if (recordInfo) {
        result.recordedAt = recordInfo.RecordDate?.[0] || null;
        result.timecode = recordInfo.Timecode?.[0] || null;
      }

      // Video format
      const videoFormat = clipMeta.VideoFormat?.[0];
      if (videoFormat) {
        result.width = parseInt(videoFormat.Width?.[0], 10) || null;
        result.height = parseInt(videoFormat.Height?.[0], 10) || null;
        result.frameRate = parseFloat(videoFormat.FrameRate?.[0]) || null;
        result.codec = videoFormat.Codec?.[0] || null;
      }

      // Scene/take
      const userClip = clipMeta.UserClipName?.[0];
      if (userClip) {
        result.reelName = userClip;
      }
      result.scene = clipMeta.Scene?.[0] || null;
      result.take = clipMeta.Take?.[0] || null;
    }
  } catch (e) {
    console.warn('[XmlSidecarService] Error parsing Canon XF:', e);
  }

  return result;
}

/**
 * Parse generic XML (best effort)
 */
function parseGenericXml(xml: any): Partial<XmlSidecarData> {
  const result: Partial<XmlSidecarData> = {
    format: 'generic',
  };

  try {
    // Try to find common fields anywhere in the structure
    const findValue = (obj: any, keys: string[]): string | null => {
      for (const key of keys) {
        if (obj && obj[key]) {
          const val = obj[key];
          if (Array.isArray(val)) {
            return val[0]?.toString() || null;
          }
          if (typeof val === 'string') {
            return val;
          }
          if (typeof val === 'object' && val['_']) {
            return val['_'];
          }
        }
      }
      return null;
    };

    const flattenAndSearch = (obj: any): void => {
      if (!obj || typeof obj !== 'object') return;

      // Look for camera info
      if (!result.make) {
        result.make = findValue(obj, ['Manufacturer', 'Make', 'CameraMake', 'manufacturer', 'make']);
      }
      if (!result.model) {
        result.model = findValue(obj, ['ModelName', 'Model', 'CameraModel', 'modelName', 'model']);
      }
      if (!result.lens) {
        result.lens = findValue(obj, ['Lens', 'LensModel', 'LensName', 'lens', 'lensModel']);
      }
      if (!result.recordedAt) {
        result.recordedAt = findValue(obj, ['CreationDate', 'RecordDate', 'CreateDate', 'DateTimeOriginal', 'creationDate', 'recordDate']);
      }
      if (!result.timecode) {
        result.timecode = findValue(obj, ['Timecode', 'StartTimecode', 'timecode', 'startTimecode']);
      }
      if (!result.reelName) {
        result.reelName = findValue(obj, ['ReelName', 'ClipName', 'UserClipName', 'reelName', 'clipName']);
      }

      // Recurse into nested objects
      for (const key of Object.keys(obj)) {
        if (typeof obj[key] === 'object') {
          flattenAndSearch(obj[key]);
        }
      }
    };

    flattenAndSearch(xml);
  } catch (e) {
    console.warn('[XmlSidecarService] Error parsing generic XML:', e);
  }

  return result;
}

/**
 * Parse an XML sidecar file
 */
export async function parseXmlSidecar(filePath: string): Promise<XmlSidecarData> {
  const xmlContent = await fs.readFile(filePath, 'utf-8');
  const xml = await parseStringPromise(xmlContent, {
    explicitArray: true,
    mergeAttrs: false,
    normalize: true,
    normalizeTags: false,
  });

  // Detect format
  const format = detectXmlFormat(xml);

  // Parse based on format
  let parsed: Partial<XmlSidecarData>;
  switch (format) {
    case 'sony_xdcam':
      parsed = parseSonyXdcam(xml);
      break;
    case 'canon_xf':
      parsed = parseCanonXf(xml);
      break;
    default:
      parsed = parseGenericXml(xml);
  }

  // Find linked video
  const linkedVideoPath = await findLinkedVideoFile(filePath);

  return {
    filePath,
    linkedVideoPath,
    format: parsed.format || 'generic',
    make: parsed.make || null,
    model: parsed.model || null,
    lens: parsed.lens || null,
    recordedAt: parsed.recordedAt || null,
    duration: parsed.duration || null,
    frameRate: parsed.frameRate || null,
    width: parsed.width || null,
    height: parsed.height || null,
    codec: parsed.codec || null,
    timecode: parsed.timecode || null,
    reelName: parsed.reelName || null,
    scene: parsed.scene || null,
    take: parsed.take || null,
    notes: parsed.notes || null,
    rawXml: xml,
  };
}

/**
 * Parse multiple XML sidecars and return a map keyed by video filename
 */
export async function parseXmlSidecars(
  xmlPaths: string[]
): Promise<Map<string, XmlSidecarData>> {
  const results = new Map<string, XmlSidecarData>();

  for (const xmlPath of xmlPaths) {
    try {
      const data = await parseXmlSidecar(xmlPath);

      // Key by linked video filename (if found) or XML filename
      if (data.linkedVideoPath) {
        const videoFilename = path.basename(data.linkedVideoPath);
        results.set(videoFilename, data);
      } else {
        const xmlFilename = path.basename(xmlPath);
        results.set(xmlFilename, data);
      }
    } catch (e) {
      console.warn(`[XmlSidecarService] Failed to parse ${xmlPath}:`, e);
    }
  }

  return results;
}

/**
 * Get XML sidecar data for a video file (if exists)
 */
export async function getXmlSidecarForVideo(videoPath: string): Promise<XmlSidecarData | null> {
  const dir = path.dirname(videoPath);
  const baseName = path.basename(videoPath, path.extname(videoPath));

  // Common XML sidecar patterns
  const xmlPatterns = [
    `${baseName}.xml`,
    `${baseName}.XML`,
    `${baseName}_metadata.xml`,
    `${baseName}M01.xml`, // Sony pattern
    `${baseName}M01.XML`,
  ];

  for (const pattern of xmlPatterns) {
    const xmlPath = path.join(dir, pattern);
    try {
      await fs.access(xmlPath);
      return parseXmlSidecar(xmlPath);
    } catch {
      // File doesn't exist, try next pattern
    }
  }

  return null;
}
