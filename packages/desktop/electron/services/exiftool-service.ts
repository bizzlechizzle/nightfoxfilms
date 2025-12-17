/**
 * ExifTool Service
 *
 * Metadata extraction using exiftool-vendored.
 * Handles EXIF, IPTC, XMP and video metadata.
 */

import { ExifTool, Tags } from 'exiftool-vendored';
import type { ExifToolResult } from '@nightfox/core';

// Singleton ExifTool instance
let exiftool: ExifTool | null = null;

/**
 * Get or create ExifTool instance
 */
function getExifTool(): ExifTool {
  if (!exiftool) {
    exiftool = new ExifTool({
      maxProcs: 4,
      taskTimeoutMillis: 30000,
    });
  }
  return exiftool;
}

/**
 * Close ExifTool instance (call on app shutdown)
 */
export async function closeExifTool(): Promise<void> {
  if (exiftool) {
    await exiftool.end();
    exiftool = null;
  }
}

/**
 * Get all metadata for a file
 */
export async function getMetadata(filePath: string): Promise<Tags> {
  const et = getExifTool();
  return et.read(filePath);
}

/**
 * Get metadata as JSON string (for storage)
 */
export async function getMetadataJson(filePath: string): Promise<string> {
  const metadata = await getMetadata(filePath);
  return JSON.stringify(metadata);
}

/**
 * Extract key info from ExifTool output
 */
export interface MediaInfo {
  make: string | null;
  model: string | null;
  createDate: Date | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  mimeType: string | null;
  majorBrand: string | null;
}

/**
 * Parse metadata into simplified MediaInfo
 */
export function parseMediaInfo(tags: Tags): MediaInfo {
  // Parse create date - check many possible fields
  // Different cameras use different metadata fields for creation date
  let createDate: Date | null = null;
  const dateFields = [
    'CreateDate',           // Most common for video
    'DateTimeOriginal',     // Common for photos, some video
    'MediaCreateDate',      // QuickTime/MP4
    'TrackCreateDate',      // Some video formats
    'CreationDate',         // Alternative field
    'ContentCreateDate',    // XMP field
    'DateCreated',          // IPTC field
    'DateTime',             // Generic EXIF
    'SubSecCreateDate',     // High precision date
    'GPSDateTime',          // If has GPS timestamp
    'FileModifyDate',       // Fallback to file modification
    'ModifyDate',           // Last resort modification date
  ];

  let fallbackDate: Date | null = null;

  for (const field of dateFields) {
    const value = (tags as any)[field];
    if (value) {
      try {
        let parsedDate: Date | null = null;

        if (value instanceof Date) {
          parsedDate = value;
        } else if (typeof value === 'string') {
          // Handle various date formats
          // ExifTool may return "YYYY:MM:DD HH:MM:SS" format
          const normalized = value.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
          parsedDate = new Date(normalized);
        } else if (value.rawValue) {
          const normalized = String(value.rawValue).replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
          parsedDate = new Date(normalized);
        } else if (typeof value === 'object' && value.year) {
          // ExifDateTime object
          parsedDate = new Date(value.year, (value.month || 1) - 1, value.day || 1,
            value.hour || 0, value.minute || 0, value.second || 0);
        }

        if (parsedDate && !isNaN(parsedDate.getTime())) {
          // FileModifyDate/ModifyDate are fallbacks - save but keep looking
          if (field === 'FileModifyDate' || field === 'ModifyDate') {
            if (!fallbackDate) {
              fallbackDate = parsedDate;
            }
            continue;
          }
          // Found a better date field - use it
          createDate = parsedDate;
          break;
        }
      } catch {
        // Date parsing failed, try next field
      }
    }
  }

  // Use fallback if no better date found
  if (!createDate && fallbackDate) {
    createDate = fallbackDate;
  }

  // Parse duration (can be in various formats)
  let duration: number | null = null;
  const durationValue = (tags as any).Duration;
  if (durationValue) {
    if (typeof durationValue === 'number') {
      duration = durationValue;
    } else if (typeof durationValue === 'string') {
      // Parse "HH:MM:SS" or "SS.ms" format
      if (durationValue.includes(':')) {
        const parts = durationValue.split(':').map(Number);
        if (parts.length === 3) {
          duration = parts[0] * 3600 + parts[1] * 60 + parts[2];
        } else if (parts.length === 2) {
          duration = parts[0] * 60 + parts[1];
        }
      } else {
        duration = parseFloat(durationValue);
      }
    }
  }

  // Check for nested Device object (Sony video files via exiftool-vendored)
  const device = (tags as any).Device as { Manufacturer?: string; ModelName?: string } | undefined;
  const deviceMake = device?.Manufacturer || null;
  const deviceModel = device?.ModelName || null;

  // Extract make - check multiple possible fields (video files use different tags)
  // Priority: Make (photos) > Device.Manufacturer (Sony video) > DeviceManufacturer > Manufacturer
  let make = extractFirstValue(tags, [
    'Make',
    'DeviceManufacturer',  // Sony MP4/XAVC (flattened)
    'Manufacturer',
    'HandlerVendorID',
    'AndroidManufacturer',  // Android phones
  ]);
  // Use nested Device.Manufacturer if flat fields are empty
  if (!make && deviceMake) {
    make = deviceMake;
  }

  // Extract model - check multiple possible fields
  // Priority: Model (photos) > Device.ModelName (Sony video) > DeviceModelName > CameraModelName
  let model = extractFirstValue(tags, [
    'Model',
    'DeviceModelName',     // Sony MP4/XAVC (flattened)
    'CameraModelName',     // Canon
    'AndroidModel',        // Android phones
    'DeviceModel',
  ]);
  // Use nested Device.ModelName if flat fields are empty
  if (!model && deviceModel) {
    model = deviceModel;
  }

  return {
    make,
    model,
    createDate,
    duration,
    width: (tags as any).ImageWidth ?? (tags as any).ExifImageWidth ?? null,
    height: (tags as any).ImageHeight ?? (tags as any).ExifImageHeight ?? null,
    frameRate: (tags as any).VideoFrameRate ?? null,
    mimeType: (tags as any).MIMEType ?? null,
    majorBrand: (tags as any).MajorBrand ?? null,
  };
}

/**
 * Extract first non-null value from a list of tag names
 */
function extractFirstValue(tags: Tags, fieldNames: string[]): string | null {
  for (const field of fieldNames) {
    const value = (tags as any)[field];
    if (value !== undefined && value !== null && value !== '') {
      return typeof value === 'string' ? value : String(value);
    }
  }
  return null;
}

/**
 * Get simplified media info for a file
 */
export async function getMediaInfo(filePath: string): Promise<MediaInfo> {
  const tags = await getMetadata(filePath);
  return parseMediaInfo(tags);
}

/**
 * Get camera make and model
 */
export async function getCameraInfo(filePath: string): Promise<{ make: string | null; model: string | null }> {
  const tags = await getMetadata(filePath);

  // Check for nested Device object (Sony video files via exiftool-vendored)
  const device = (tags as any).Device as { Manufacturer?: string; ModelName?: string } | undefined;

  let make = extractFirstValue(tags, [
    'Make',
    'DeviceManufacturer',
    'Manufacturer',
    'HandlerVendorID',
    'AndroidManufacturer',
  ]);
  if (!make && device?.Manufacturer) {
    make = device.Manufacturer;
  }

  let model = extractFirstValue(tags, [
    'Model',
    'DeviceModelName',
    'CameraModelName',
    'AndroidModel',
    'DeviceModel',
  ]);
  if (!model && device?.ModelName) {
    model = device.ModelName;
  }

  return { make, model };
}

/**
 * Get file creation date
 */
export async function getCreateDate(filePath: string): Promise<Date | null> {
  const info = await getMediaInfo(filePath);
  return info.createDate;
}

/**
 * Check if file has GPS data
 */
export async function hasGpsData(filePath: string): Promise<boolean> {
  const tags = await getMetadata(filePath);
  return (tags as any).GPSLatitude !== undefined && (tags as any).GPSLongitude !== undefined;
}

/**
 * Get GPS coordinates
 */
export async function getGpsCoordinates(
  filePath: string
): Promise<{ latitude: number; longitude: number } | null> {
  const tags = await getMetadata(filePath);
  const lat = (tags as any).GPSLatitude;
  const lng = (tags as any).GPSLongitude;

  if (lat === undefined || lng === undefined) {
    return null;
  }

  return {
    latitude: typeof lat === 'number' ? lat : parseFloat(lat),
    longitude: typeof lng === 'number' ? lng : parseFloat(lng),
  };
}

/**
 * Get video-specific metadata
 */
export async function getVideoExifMetadata(filePath: string): Promise<{
  duration: number | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  codec: string | null;
  rotation: number | null;
}> {
  const tags = await getMetadata(filePath);

  let duration: number | null = null;
  const durationValue = (tags as any).Duration;
  if (typeof durationValue === 'number') {
    duration = durationValue;
  } else if (typeof durationValue === 'string') {
    duration = parseFloat(durationValue);
  }

  return {
    duration,
    width: (tags as any).ImageWidth ?? null,
    height: (tags as any).ImageHeight ?? null,
    frameRate: (tags as any).VideoFrameRate ?? null,
    codec: (tags as any).CompressorName ?? (tags as any).VideoCodec ?? null,
    rotation: (tags as any).Rotation ?? null,
  };
}

/**
 * Convert ExifTool Tags to our ExifToolResult format
 */
export function toExifToolResult(tags: Tags, filePath: string): ExifToolResult {
  // Check for nested Device object (Sony video files via exiftool-vendored)
  const device = (tags as any).Device as { Manufacturer?: string; ModelName?: string } | undefined;

  // Extract make/model using the multi-field logic
  let make = extractFirstValue(tags, [
    'Make',
    'DeviceManufacturer',
    'Manufacturer',
    'HandlerVendorID',
    'AndroidManufacturer',
  ]);
  if (!make && device?.Manufacturer) {
    make = device.Manufacturer;
  }

  let model = extractFirstValue(tags, [
    'Model',
    'DeviceModelName',
    'CameraModelName',
    'AndroidModel',
    'DeviceModel',
  ]);
  if (!model && device?.ModelName) {
    model = device.ModelName;
  }

  return {
    SourceFile: filePath,
    FileName: (tags as any).FileName ?? '',
    FileSize: (tags as any).FileSize ?? '',
    FileType: (tags as any).FileType ?? '',
    MIMEType: (tags as any).MIMEType ?? '',
    Make: make ?? undefined,
    Model: model ?? undefined,
    CreateDate: (tags as any).CreateDate?.toString(),
    ModifyDate: (tags as any).ModifyDate?.toString(),
    Duration: (tags as any).Duration,
    ImageWidth: (tags as any).ImageWidth,
    ImageHeight: (tags as any).ImageHeight,
    VideoFrameRate: (tags as any).VideoFrameRate,
    AudioChannels: (tags as any).AudioChannels,
    AudioSampleRate: (tags as any).AudioSampleRate,
    GPSLatitude: (tags as any).GPSLatitude?.toString(),
    GPSLongitude: (tags as any).GPSLongitude?.toString(),
    // Include original fields for reference
    DeviceManufacturer: (tags as any).DeviceManufacturer,
    DeviceModelName: (tags as any).DeviceModelName,
    LensModelName: (tags as any).LensModelName,
    ...tags,
  };
}
