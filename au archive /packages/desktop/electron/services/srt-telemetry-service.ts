/**
 * SRT Telemetry Service (OPT-055)
 *
 * Parses DJI drone SRT telemetry files and extracts summary data.
 * DJI drones record frame-by-frame GPS, altitude, speed, and gimbal data
 * in SRT (subtitle) format alongside video files.
 *
 * This service:
 * - Detects if an SRT file contains DJI telemetry (vs standard subtitles)
 * - Parses the telemetry to extract GPS bounds, altitude range, duration
 * - Links parsed data to matching video records by filename
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Telemetry summary stored on video record
 * Stored as JSON in vids.srt_telemetry column
 */
export interface TelemetrySummary {
  frames: number;
  duration_sec: number;
  gps_bounds: {
    min_lat: number;
    max_lat: number;
    min_lng: number;
    max_lng: number;
  } | null;
  altitude_range: {
    min_m: number;
    max_m: number;
  } | null;
  speed_max_ms: number | null;
  parsed_from: string;
  parsed_at: string;
}

/**
 * Single frame of telemetry data
 */
interface TelemetryFrame {
  frameNumber: number;
  startTime: string;
  endTime: string;
  lat: number | null;
  lng: number | null;
  altitude: number | null;
  distance: number | null;
  height: number | null;
  horizontalSpeed: number | null;
  verticalSpeed: number | null;
  fStop: string | null;
  shutterSpeed: string | null;
  iso: number | null;
  ev: number | null;
}

/**
 * Check if SRT content is DJI telemetry format
 *
 * DJI SRT files contain GPS coordinates in format: GPS (lat, lng, alt)
 * Standard subtitle files contain plain text without GPS data
 */
export function isDjiTelemetry(content: string): boolean {
  // DJI telemetry contains GPS coordinates in this format
  // GPS (42.1234, -73.5678, 150) or GPS(42.1234, -73.5678, 150)
  const gpsPattern = /GPS\s*\(\s*-?\d+\.?\d*\s*,\s*-?\d+\.?\d*\s*,\s*-?\d+\.?\d*\s*\)/i;

  // Also check for DJI-specific metadata patterns
  const djiPatterns = [
    /\bF\/\d+\.?\d*\b/,        // F/2.8 aperture
    /\bSS\s*\d+\b/i,           // SS 320 shutter speed
    /\bISO\s*\d+\b/i,          // ISO 100
    /\bEV\s*[-+]?\d+\b/i,      // EV 0
    /\bD\s*\d+\.?\d*m\b/i,     // D 25.2m distance
    /\bH\s*\d+\.?\d*m\b/i,     // H 45.3m height
    /\bHS\s*\d+\.?\d*m\/s\b/i, // HS 5.2m/s horizontal speed
    /\bVS\s*[-+]?\d+\.?\d*m\/s\b/i, // VS 0.0m/s vertical speed
  ];

  // Must have GPS data to be telemetry
  if (!gpsPattern.test(content)) {
    return false;
  }

  // Check for at least 2 DJI-specific patterns (belt and suspenders)
  let patternMatches = 0;
  for (const pattern of djiPatterns) {
    if (pattern.test(content)) {
      patternMatches++;
    }
    if (patternMatches >= 2) {
      return true;
    }
  }

  // If we have GPS but not enough DJI patterns, still accept if multiple GPS lines
  const gpsMatches = content.match(new RegExp(gpsPattern.source, 'gi'));
  return (gpsMatches?.length ?? 0) >= 3;
}

/**
 * Parse DJI SRT telemetry file and extract summary
 *
 * DJI SRT format example:
 * ```
 * 1
 * 00:00:00,033 --> 00:00:00,066
 * F/2.8, SS 320, ISO 100, EV 0, GPS (42.1234, -73.5678, 150), D 25.2m, H 45.3m, HS 5.2m/s, VS 0.0m/s
 *
 * 2
 * 00:00:00,066 --> 00:00:00,100
 * F/2.8, SS 320, ISO 100, EV 0, GPS (42.1235, -73.5677, 151), D 25.5m, H 45.5m, HS 5.3m/s, VS 0.1m/s
 * ```
 */
export function parseDjiSrt(content: string, filename: string): TelemetrySummary {
  const frames: TelemetryFrame[] = [];

  // Split into subtitle blocks (separated by blank lines)
  const blocks = content.split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;

    // First line is frame number
    const frameNumber = parseInt(lines[0], 10);
    if (isNaN(frameNumber)) continue;

    // Second line is timestamp: 00:00:00,033 --> 00:00:00,066
    const timeMatch = lines[1].match(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/);
    if (!timeMatch) continue;

    const startTime = timeMatch[1];
    const endTime = timeMatch[2];

    // Third line (and potentially more) is telemetry data
    const dataLine = lines.slice(2).join(' ');

    const frame = parseTelemetryLine(frameNumber, startTime, endTime, dataLine);
    frames.push(frame);
  }

  // Calculate summary statistics
  return calculateSummary(frames, filename);
}

/**
 * Parse a single telemetry data line
 */
function parseTelemetryLine(
  frameNumber: number,
  startTime: string,
  endTime: string,
  dataLine: string
): TelemetryFrame {
  const frame: TelemetryFrame = {
    frameNumber,
    startTime,
    endTime,
    lat: null,
    lng: null,
    altitude: null,
    distance: null,
    height: null,
    horizontalSpeed: null,
    verticalSpeed: null,
    fStop: null,
    shutterSpeed: null,
    iso: null,
    ev: null,
  };

  // GPS (lat, lng, alt)
  const gpsMatch = dataLine.match(/GPS\s*\(\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*\)/i);
  if (gpsMatch) {
    frame.lat = parseFloat(gpsMatch[1]);
    frame.lng = parseFloat(gpsMatch[2]);
    frame.altitude = parseFloat(gpsMatch[3]);
  }

  // D 25.2m (distance from home)
  const distMatch = dataLine.match(/\bD\s*(\d+\.?\d*)m\b/i);
  if (distMatch) {
    frame.distance = parseFloat(distMatch[1]);
  }

  // H 45.3m (height/altitude above takeoff)
  const heightMatch = dataLine.match(/\bH\s*(\d+\.?\d*)m\b/i);
  if (heightMatch) {
    frame.height = parseFloat(heightMatch[1]);
  }

  // HS 5.2m/s (horizontal speed)
  const hsMatch = dataLine.match(/\bHS\s*(\d+\.?\d*)m\/s\b/i);
  if (hsMatch) {
    frame.horizontalSpeed = parseFloat(hsMatch[1]);
  }

  // VS 0.0m/s (vertical speed, can be negative)
  const vsMatch = dataLine.match(/\bVS\s*([-+]?\d+\.?\d*)m\/s\b/i);
  if (vsMatch) {
    frame.verticalSpeed = parseFloat(vsMatch[1]);
  }

  // F/2.8
  const fMatch = dataLine.match(/\bF\/(\d+\.?\d*)\b/);
  if (fMatch) {
    frame.fStop = fMatch[1];
  }

  // SS 320
  const ssMatch = dataLine.match(/\bSS\s*(\d+)\b/i);
  if (ssMatch) {
    frame.shutterSpeed = ssMatch[1];
  }

  // ISO 100
  const isoMatch = dataLine.match(/\bISO\s*(\d+)\b/i);
  if (isoMatch) {
    frame.iso = parseInt(isoMatch[1], 10);
  }

  // EV 0
  const evMatch = dataLine.match(/\bEV\s*([-+]?\d+)\b/i);
  if (evMatch) {
    frame.ev = parseInt(evMatch[1], 10);
  }

  return frame;
}

/**
 * Calculate summary statistics from parsed frames
 */
function calculateSummary(frames: TelemetryFrame[], filename: string): TelemetrySummary {
  if (frames.length === 0) {
    return {
      frames: 0,
      duration_sec: 0,
      gps_bounds: null,
      altitude_range: null,
      speed_max_ms: null,
      parsed_from: filename,
      parsed_at: new Date().toISOString(),
    };
  }

  // Calculate duration from first and last frame timestamps
  const firstFrame = frames[0];
  const lastFrame = frames[frames.length - 1];
  const duration_sec = parseTimestamp(lastFrame.endTime) - parseTimestamp(firstFrame.startTime);

  // Calculate GPS bounds
  const gpsFrames = frames.filter(f => f.lat !== null && f.lng !== null);
  let gps_bounds: TelemetrySummary['gps_bounds'] = null;
  if (gpsFrames.length > 0) {
    const lats = gpsFrames.map(f => f.lat!);
    const lngs = gpsFrames.map(f => f.lng!);
    gps_bounds = {
      min_lat: Math.min(...lats),
      max_lat: Math.max(...lats),
      min_lng: Math.min(...lngs),
      max_lng: Math.max(...lngs),
    };
  }

  // Calculate altitude range (prefer height over GPS altitude)
  const altFrames = frames.filter(f => f.height !== null || f.altitude !== null);
  let altitude_range: TelemetrySummary['altitude_range'] = null;
  if (altFrames.length > 0) {
    const alts = altFrames.map(f => f.height ?? f.altitude!);
    altitude_range = {
      min_m: Math.min(...alts),
      max_m: Math.max(...alts),
    };
  }

  // Calculate max speed
  const speedFrames = frames.filter(f => f.horizontalSpeed !== null);
  let speed_max_ms: number | null = null;
  if (speedFrames.length > 0) {
    speed_max_ms = Math.max(...speedFrames.map(f => f.horizontalSpeed!));
  }

  return {
    frames: frames.length,
    duration_sec: Math.round(duration_sec * 100) / 100,
    gps_bounds,
    altitude_range,
    speed_max_ms,
    parsed_from: filename,
    parsed_at: new Date().toISOString(),
  };
}

/**
 * Parse SRT timestamp to seconds
 * Format: 00:00:00,033 (HH:MM:SS,mmm)
 */
function parseTimestamp(timestamp: string): number {
  const match = timestamp.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
  if (!match) return 0;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  const millis = parseInt(match[4], 10);

  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

/**
 * Get base filename without extension
 * DJI_0001.SRT -> DJI_0001
 */
export function getBaseName(filename: string): string {
  return path.basename(filename, path.extname(filename));
}

/**
 * Find matching video for an SRT file
 * Matches by basename: DJI_0001.SRT -> DJI_0001.MP4
 */
export function findMatchingVideoHash(
  srtFilename: string,
  videos: Array<{ vidhash: string; vidnamo: string }>
): string | null {
  const srtBase = getBaseName(srtFilename).toLowerCase();

  for (const video of videos) {
    const videoBase = getBaseName(video.vidnamo).toLowerCase();
    if (videoBase === srtBase) {
      return video.vidhash;
    }
  }

  return null;
}

/**
 * Parse SRT file from disk and return summary if it's DJI telemetry
 */
export async function parseSrtFile(filePath: string): Promise<TelemetrySummary | null> {
  const content = await fs.readFile(filePath, 'utf-8');

  if (!isDjiTelemetry(content)) {
    return null;
  }

  const filename = path.basename(filePath);
  return parseDjiSrt(content, filename);
}
