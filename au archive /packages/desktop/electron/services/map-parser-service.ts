/**
 * Map Parser Service
 * Parses various map file formats (KML, KMZ, GPX, GeoJSON, Shapefile, CSV)
 * and extracts points with coordinates and metadata.
 * OPT-027: Uses async I/O to avoid blocking the event loop
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { DOMParser } from '@xmldom/xmldom';
import * as unzipper from 'unzipper';

export interface ParsedMapPoint {
  name: string | null;
  description: string | null;
  lat: number;
  lng: number;
  state: string | null;
  category: string | null;
  rawMetadata: Record<string, unknown> | null;
}

export interface ParsedMapResult {
  success: boolean;
  points: ParsedMapPoint[];
  fileType: string;
  error?: string;
}

/**
 * Detect file type from extension
 */
function getFileType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.kml': return 'kml';
    case '.kmz': return 'kmz';
    case '.gpx': return 'gpx';
    case '.geojson':
    case '.json': return 'geojson';
    case '.shp': return 'shp';
    case '.csv': return 'csv';
    default: return 'unknown';
  }
}

/**
 * Parse KML content and extract placemarks
 */
function parseKML(content: string): ParsedMapPoint[] {
  const points: ParsedMapPoint[] = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/xml');

  // Get all Placemark elements
  const placemarks = doc.getElementsByTagName('Placemark');

  for (let i = 0; i < placemarks.length; i++) {
    const placemark = placemarks[i];

    // Get name
    const nameEl = placemark.getElementsByTagName('name')[0];
    const name = nameEl?.textContent?.trim() || null;

    // Get description
    const descEl = placemark.getElementsByTagName('description')[0];
    const description = descEl?.textContent?.trim() || null;

    // Try Point coordinates first
    const pointEl = placemark.getElementsByTagName('Point')[0];
    if (pointEl) {
      const coordsEl = pointEl.getElementsByTagName('coordinates')[0];
      if (coordsEl?.textContent) {
        const coords = coordsEl.textContent.trim().split(',');
        if (coords.length >= 2) {
          const lng = parseFloat(coords[0]);
          const lat = parseFloat(coords[1]);
          if (!isNaN(lat) && !isNaN(lng)) {
            points.push({
              name,
              description,
              lat,
              lng,
              state: null,
              category: getCategory(placemark),
              rawMetadata: extractKMLMetadata(placemark)
            });
          }
        }
      }
    }

    // Also check for LineString and Polygon (use centroid or first point)
    const lineString = placemark.getElementsByTagName('LineString')[0];
    if (lineString && !pointEl) {
      const coordsEl = lineString.getElementsByTagName('coordinates')[0];
      if (coordsEl?.textContent) {
        const firstCoord = coordsEl.textContent.trim().split(/\s+/)[0];
        const coords = firstCoord.split(',');
        if (coords.length >= 2) {
          const lng = parseFloat(coords[0]);
          const lat = parseFloat(coords[1]);
          if (!isNaN(lat) && !isNaN(lng)) {
            points.push({
              name,
              description,
              lat,
              lng,
              state: null,
              category: getCategory(placemark) || 'line',
              rawMetadata: extractKMLMetadata(placemark)
            });
          }
        }
      }
    }

    const polygon = placemark.getElementsByTagName('Polygon')[0];
    if (polygon && !pointEl && !lineString) {
      const outerBoundary = polygon.getElementsByTagName('outerBoundaryIs')[0];
      if (outerBoundary) {
        const linearRing = outerBoundary.getElementsByTagName('LinearRing')[0];
        if (linearRing) {
          const coordsEl = linearRing.getElementsByTagName('coordinates')[0];
          if (coordsEl?.textContent) {
            // Calculate centroid of polygon
            const coordPairs = coordsEl.textContent.trim().split(/\s+/);
            let sumLat = 0, sumLng = 0, count = 0;
            for (const pair of coordPairs) {
              const coords = pair.split(',');
              if (coords.length >= 2) {
                const lng = parseFloat(coords[0]);
                const lat = parseFloat(coords[1]);
                if (!isNaN(lat) && !isNaN(lng)) {
                  sumLat += lat;
                  sumLng += lng;
                  count++;
                }
              }
            }
            if (count > 0) {
              points.push({
                name,
                description,
                lat: sumLat / count,
                lng: sumLng / count,
                state: null,
                category: getCategory(placemark) || 'polygon',
                rawMetadata: extractKMLMetadata(placemark)
              });
            }
          }
        }
      }
    }
  }

  return points;
}

/**
 * Extract category from KML styleUrl or folder
 */
function getCategory(placemark: Element): string | null {
  const styleUrl = placemark.getElementsByTagName('styleUrl')[0];
  if (styleUrl?.textContent) {
    // Extract style name from #styleName format
    const style = styleUrl.textContent.replace('#', '');
    if (style) return style;
  }

  // Check parent folder name
  let parent = placemark.parentNode;
  while (parent) {
    if (parent.nodeName === 'Folder') {
      const folderName = (parent as Element).getElementsByTagName('name')[0];
      if (folderName?.textContent) {
        return folderName.textContent.trim();
      }
    }
    parent = parent.parentNode;
  }

  return null;
}

/**
 * Extract extended data from KML placemark
 */
function extractKMLMetadata(placemark: Element): Record<string, unknown> | null {
  const metadata: Record<string, unknown> = {};

  // Check ExtendedData
  const extendedData = placemark.getElementsByTagName('ExtendedData')[0];
  if (extendedData) {
    // SimpleData elements
    const simpleData = extendedData.getElementsByTagName('SimpleData');
    for (let i = 0; i < simpleData.length; i++) {
      const el = simpleData[i];
      const name = el.getAttribute('name');
      if (name && el.textContent) {
        metadata[name] = el.textContent.trim();
      }
    }

    // Data elements
    const dataElements = extendedData.getElementsByTagName('Data');
    for (let i = 0; i < dataElements.length; i++) {
      const el = dataElements[i];
      const name = el.getAttribute('name');
      const value = el.getElementsByTagName('value')[0];
      if (name && value?.textContent) {
        metadata[name] = value.textContent.trim();
      }
    }
  }

  return Object.keys(metadata).length > 0 ? metadata : null;
}

/**
 * Parse GPX content
 */
function parseGPX(content: string): ParsedMapPoint[] {
  const points: ParsedMapPoint[] = [];
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'text/xml');

  // Waypoints
  const waypoints = doc.getElementsByTagName('wpt');
  for (let i = 0; i < waypoints.length; i++) {
    const wpt = waypoints[i];
    const lat = parseFloat(wpt.getAttribute('lat') || '');
    const lng = parseFloat(wpt.getAttribute('lon') || '');

    if (!isNaN(lat) && !isNaN(lng)) {
      const nameEl = wpt.getElementsByTagName('name')[0];
      const descEl = wpt.getElementsByTagName('desc')[0];
      const typeEl = wpt.getElementsByTagName('type')[0];

      points.push({
        name: nameEl?.textContent?.trim() || null,
        description: descEl?.textContent?.trim() || null,
        lat,
        lng,
        state: null,
        category: typeEl?.textContent?.trim() || 'waypoint',
        rawMetadata: extractGPXMetadata(wpt)
      });
    }
  }

  // Track points (use first point of each track segment as representative)
  const tracks = doc.getElementsByTagName('trk');
  for (let i = 0; i < tracks.length; i++) {
    const trk = tracks[i];
    const trkNameEl = trk.getElementsByTagName('name')[0];
    const trkName = trkNameEl?.textContent?.trim() || `Track ${i + 1}`;

    const segments = trk.getElementsByTagName('trkseg');
    for (let j = 0; j < segments.length; j++) {
      const trkpts = segments[j].getElementsByTagName('trkpt');
      if (trkpts.length > 0) {
        // Use first point as representative
        const firstPt = trkpts[0];
        const lat = parseFloat(firstPt.getAttribute('lat') || '');
        const lng = parseFloat(firstPt.getAttribute('lon') || '');

        if (!isNaN(lat) && !isNaN(lng)) {
          points.push({
            name: trkName,
            description: `Track with ${trkpts.length} points`,
            lat,
            lng,
            state: null,
            category: 'track',
            rawMetadata: { pointCount: trkpts.length }
          });
        }
      }
    }
  }

  // Route points
  const routes = doc.getElementsByTagName('rte');
  for (let i = 0; i < routes.length; i++) {
    const rte = routes[i];
    const rteNameEl = rte.getElementsByTagName('name')[0];
    const rteName = rteNameEl?.textContent?.trim() || `Route ${i + 1}`;

    const rtepts = rte.getElementsByTagName('rtept');
    if (rtepts.length > 0) {
      const firstPt = rtepts[0];
      const lat = parseFloat(firstPt.getAttribute('lat') || '');
      const lng = parseFloat(firstPt.getAttribute('lon') || '');

      if (!isNaN(lat) && !isNaN(lng)) {
        points.push({
          name: rteName,
          description: `Route with ${rtepts.length} points`,
          lat,
          lng,
          state: null,
          category: 'route',
          rawMetadata: { pointCount: rtepts.length }
        });
      }
    }
  }

  return points;
}

/**
 * Extract metadata from GPX waypoint
 */
function extractGPXMetadata(wpt: Element): Record<string, unknown> | null {
  const metadata: Record<string, unknown> = {};

  const eleEl = wpt.getElementsByTagName('ele')[0];
  if (eleEl?.textContent) metadata.elevation = parseFloat(eleEl.textContent);

  const timeEl = wpt.getElementsByTagName('time')[0];
  if (timeEl?.textContent) metadata.time = timeEl.textContent;

  const symEl = wpt.getElementsByTagName('sym')[0];
  if (symEl?.textContent) metadata.symbol = symEl.textContent;

  const cmtEl = wpt.getElementsByTagName('cmt')[0];
  if (cmtEl?.textContent) metadata.comment = cmtEl.textContent;

  return Object.keys(metadata).length > 0 ? metadata : null;
}

/**
 * Parse GeoJSON content
 */
function parseGeoJSON(content: string): ParsedMapPoint[] {
  const points: ParsedMapPoint[] = [];

  const data = JSON.parse(content);

  // Handle FeatureCollection
  if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
    for (const feature of data.features) {
      extractGeoJSONPoints(feature, points);
    }
  } else if (data.type === 'Feature') {
    extractGeoJSONPoints(data, points);
  } else if (data.type && data.coordinates) {
    // Raw geometry
    extractGeoJSONPoints({ type: 'Feature', geometry: data, properties: {} }, points);
  }

  return points;
}

/**
 * Extract points from a GeoJSON feature
 */
function extractGeoJSONPoints(feature: { type: string; geometry?: { type: string; coordinates: number[] | number[][] | number[][][] }; properties?: Record<string, unknown> }, points: ParsedMapPoint[]): void {
  if (!feature.geometry) return;

  const props = feature.properties || {};
  const name = (props.name || props.Name || props.NAME || props.title || null) as string | null;
  const description = (props.description || props.Description || props.DESCRIPTION || null) as string | null;
  const category = (props.category || props.Category || props.type || props.Type || null) as string | null;

  const { type, coordinates } = feature.geometry;

  if (type === 'Point' && Array.isArray(coordinates) && coordinates.length >= 2) {
    const [lng, lat] = coordinates as number[];
    if (!isNaN(lat) && !isNaN(lng)) {
      points.push({
        name,
        description,
        lat,
        lng,
        state: (props.state || props.State || props.STATE || null) as string | null,
        category,
        rawMetadata: Object.keys(props).length > 0 ? props : null
      });
    }
  } else if (type === 'LineString' && Array.isArray(coordinates) && coordinates.length > 0) {
    // Use first point
    const firstCoord = coordinates[0] as number[];
    if (Array.isArray(firstCoord) && firstCoord.length >= 2) {
      const [lng, lat] = firstCoord;
      if (!isNaN(lat) && !isNaN(lng)) {
        points.push({
          name,
          description: description || `Line with ${coordinates.length} points`,
          lat,
          lng,
          state: (props.state || props.State || null) as string | null,
          category: category || 'line',
          rawMetadata: Object.keys(props).length > 0 ? props : null
        });
      }
    }
  } else if (type === 'Polygon' && Array.isArray(coordinates) && coordinates.length > 0) {
    // Calculate centroid of outer ring
    const outerRing = coordinates[0] as number[][];
    if (Array.isArray(outerRing) && outerRing.length > 0) {
      let sumLat = 0, sumLng = 0;
      for (const coord of outerRing) {
        if (Array.isArray(coord) && coord.length >= 2) {
          sumLng += coord[0];
          sumLat += coord[1];
        }
      }
      const count = outerRing.length;
      if (count > 0) {
        points.push({
          name,
          description: description || `Polygon with ${count} vertices`,
          lat: sumLat / count,
          lng: sumLng / count,
          state: (props.state || props.State || null) as string | null,
          category: category || 'polygon',
          rawMetadata: Object.keys(props).length > 0 ? props : null
        });
      }
    }
  } else if (type === 'MultiPoint' && Array.isArray(coordinates)) {
    for (let i = 0; i < coordinates.length; i++) {
      const coord = coordinates[i] as number[];
      if (Array.isArray(coord) && coord.length >= 2) {
        const [lng, lat] = coord;
        if (!isNaN(lat) && !isNaN(lng)) {
          points.push({
            name: name ? `${name} (${i + 1})` : null,
            description,
            lat,
            lng,
            state: (props.state || props.State || null) as string | null,
            category,
            rawMetadata: Object.keys(props).length > 0 ? props : null
          });
        }
      }
    }
  }
}

/**
 * Parse CSV content with lat/lng columns
 */
function parseCSV(content: string): ParsedMapPoint[] {
  const points: ParsedMapPoint[] = [];
  const lines = content.split(/\r?\n/);

  if (lines.length < 2) return points;

  // Parse header
  const header = parseCSVLine(lines[0]);
  const headerLower = header.map(h => h.toLowerCase().trim());

  // Find lat/lng columns
  const latIndex = headerLower.findIndex(h =>
    h === 'lat' || h === 'latitude' || h === 'y'
  );
  const lngIndex = headerLower.findIndex(h =>
    h === 'lng' || h === 'lon' || h === 'longitude' || h === 'long' || h === 'x'
  );

  if (latIndex === -1 || lngIndex === -1) {
    throw new Error('CSV must have latitude and longitude columns (lat/latitude/y and lng/lon/longitude/long/x)');
  }

  // Find optional columns
  const nameIndex = headerLower.findIndex(h => h === 'name' || h === 'title');
  const descIndex = headerLower.findIndex(h => h === 'description' || h === 'desc' || h === 'notes');
  const stateIndex = headerLower.findIndex(h => h === 'state');
  const categoryIndex = headerLower.findIndex(h => h === 'category' || h === 'type');

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);
    const lat = parseFloat(values[latIndex] || '');
    const lng = parseFloat(values[lngIndex] || '');

    if (isNaN(lat) || isNaN(lng)) continue;

    // Build metadata from all columns
    const metadata: Record<string, unknown> = {};
    for (let j = 0; j < header.length; j++) {
      if (j !== latIndex && j !== lngIndex && values[j]) {
        metadata[header[j]] = values[j];
      }
    }

    points.push({
      name: nameIndex >= 0 ? values[nameIndex] || null : null,
      description: descIndex >= 0 ? values[descIndex] || null : null,
      lat,
      lng,
      state: stateIndex >= 0 ? values[stateIndex] || null : null,
      category: categoryIndex >= 0 ? values[categoryIndex] || null : null,
      rawMetadata: Object.keys(metadata).length > 0 ? metadata : null
    });
  }

  return points;
}

/**
 * Parse a single CSV line handling quoted fields
 */
function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

/**
 * Extract KML from KMZ file (which is a ZIP archive)
 */
async function extractKMLFromKMZ(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let kmlContent = '';

    fs.createReadStream(filePath)
      .pipe(unzipper.Parse())
      .on('entry', async (entry) => {
        const fileName = entry.path;
        if (fileName.toLowerCase().endsWith('.kml')) {
          const chunks: Buffer[] = [];
          entry.on('data', (chunk: Buffer) => chunks.push(chunk));
          entry.on('end', () => {
            kmlContent = Buffer.concat(chunks).toString('utf8');
          });
        } else {
          entry.autodrain();
        }
      })
      .on('close', () => {
        if (kmlContent) {
          resolve(kmlContent);
        } else {
          reject(new Error('No KML file found in KMZ archive'));
        }
      })
      .on('error', reject);
  });
}

/**
 * Main entry point: Parse any supported map file
 */
export async function parseMapFile(filePath: string): Promise<ParsedMapResult> {
  const fileType = getFileType(filePath);

  if (fileType === 'unknown') {
    return {
      success: false,
      points: [],
      fileType: 'unknown',
      error: `Unsupported file type: ${path.extname(filePath)}`
    };
  }

  try {
    let points: ParsedMapPoint[] = [];

    // OPT-027: Use async I/O to avoid blocking the event loop
    switch (fileType) {
      case 'kml': {
        const content = await fsPromises.readFile(filePath, 'utf8');
        points = parseKML(content);
        break;
      }

      case 'kmz': {
        const kmlContent = await extractKMLFromKMZ(filePath);
        points = parseKML(kmlContent);
        break;
      }

      case 'gpx': {
        const content = await fsPromises.readFile(filePath, 'utf8');
        points = parseGPX(content);
        break;
      }

      case 'geojson': {
        const content = await fsPromises.readFile(filePath, 'utf8');
        points = parseGeoJSON(content);
        break;
      }

      case 'csv': {
        const content = await fsPromises.readFile(filePath, 'utf8');
        points = parseCSV(content);
        break;
      }

      case 'shp': {
        // Shapefile support requires additional handling
        // For now, return error - can add shapefile-js in future
        return {
          success: false,
          points: [],
          fileType: 'shp',
          error: 'Shapefile support requires conversion to GeoJSON first. Use QGIS or ogr2ogr to convert.'
        };
      }
    }

    return {
      success: true,
      points,
      fileType
    };

  } catch (error) {
    return {
      success: false,
      points: [],
      fileType,
      error: error instanceof Error ? error.message : 'Unknown error parsing map file'
    };
  }
}

/**
 * Get supported file extensions
 */
export function getSupportedExtensions(): string[] {
  return ['.kml', '.kmz', '.gpx', '.geojson', '.json', '.csv'];
}

/**
 * Check if a file is a supported map file
 */
export function isSupportedMapFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return getSupportedExtensions().includes(ext);
}
