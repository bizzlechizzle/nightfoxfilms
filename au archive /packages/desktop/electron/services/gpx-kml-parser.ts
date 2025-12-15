/**
 * GPX/KML Parser Service
 * FIX 3.4: Parse GPX and KML files to extract GPS coordinates
 *
 * Lightweight regex-based parser for map file formats.
 * Extracts waypoints, track points, and route points from GPX files.
 * Extracts Placemarks and coordinates from KML files.
 */
import fs from 'fs/promises';

export interface GPSPoint {
  lat: number;
  lng: number;
  ele?: number;       // Elevation in meters
  time?: string;      // ISO timestamp
  name?: string;      // Waypoint/placemark name
  desc?: string;      // Description
}

export interface TrackSegment {
  name?: string;
  points: GPSPoint[];
}

export interface MapFileData {
  format: 'gpx' | 'kml' | 'kmz' | 'unknown';
  name?: string;
  description?: string;
  waypoints: GPSPoint[];
  tracks: TrackSegment[];
  routes: TrackSegment[];
  bounds?: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };
  centerPoint?: GPSPoint;
  totalPoints: number;
}

/**
 * Parse GPX and KML files to extract GPS data
 */
export class GPXKMLParser {
  /**
   * Parse a map file (GPX, KML, or KMZ)
   */
  async parseFile(filePath: string): Promise<MapFileData> {
    const ext = filePath.toLowerCase().split('.').pop() || '';

    try {
      const content = await fs.readFile(filePath, 'utf-8');

      if (ext === 'gpx') {
        return this.parseGPX(content);
      } else if (ext === 'kml') {
        return this.parseKML(content);
      } else if (ext === 'kmz') {
        // KMZ is a zipped KML - would need unzip support
        // For now, return basic structure
        console.log('[GPXKMLParser] KMZ parsing not yet supported');
        return this.createEmptyResult('kmz');
      } else {
        return this.createEmptyResult('unknown');
      }
    } catch (error) {
      console.error('[GPXKMLParser] Failed to parse file:', error);
      return this.createEmptyResult('unknown');
    }
  }

  /**
   * Parse GPX (GPS Exchange Format) content
   * GPX uses: <wpt>, <trkpt>, <rtept> for waypoints, track points, route points
   */
  private parseGPX(content: string): MapFileData {
    const result: MapFileData = {
      format: 'gpx',
      waypoints: [],
      tracks: [],
      routes: [],
      totalPoints: 0,
    };

    // Extract metadata name
    const nameMatch = content.match(/<metadata[^>]*>[\s\S]*?<name[^>]*>([\s\S]*?)<\/name>/i);
    if (nameMatch) {
      result.name = this.decodeXMLEntities(nameMatch[1].trim());
    }

    // Extract waypoints <wpt lat="..." lon="...">
    const wptRegex = /<wpt\s+lat=["']([^"']+)["']\s+lon=["']([^"']+)["'][^>]*>([\s\S]*?)<\/wpt>/gi;
    let match;
    while ((match = wptRegex.exec(content)) !== null) {
      const point = this.parseGPXPoint(match[1], match[2], match[3]);
      if (point) {
        result.waypoints.push(point);
        result.totalPoints++;
      }
    }

    // Extract tracks <trk> containing <trkseg> with <trkpt>
    const trkRegex = /<trk[^>]*>([\s\S]*?)<\/trk>/gi;
    while ((match = trkRegex.exec(content)) !== null) {
      const trackContent = match[1];
      const track: TrackSegment = {
        name: this.extractXMLValue(trackContent, 'name'),
        points: [],
      };

      // Extract track segments
      const trksegRegex = /<trkseg[^>]*>([\s\S]*?)<\/trkseg>/gi;
      let segMatch;
      while ((segMatch = trksegRegex.exec(trackContent)) !== null) {
        const segContent = segMatch[1];

        // Extract track points
        const trkptRegex = /<trkpt\s+lat=["']([^"']+)["']\s+lon=["']([^"']+)["'][^>]*>([\s\S]*?)<\/trkpt>/gi;
        let ptMatch;
        while ((ptMatch = trkptRegex.exec(segContent)) !== null) {
          const point = this.parseGPXPoint(ptMatch[1], ptMatch[2], ptMatch[3]);
          if (point) {
            track.points.push(point);
            result.totalPoints++;
          }
        }

        // Also handle self-closing trkpt tags
        const trkptSelfRegex = /<trkpt\s+lat=["']([^"']+)["']\s+lon=["']([^"']+)["'][^>]*\/>/gi;
        while ((ptMatch = trkptSelfRegex.exec(segContent)) !== null) {
          const point = this.parseGPXPoint(ptMatch[1], ptMatch[2], '');
          if (point) {
            track.points.push(point);
            result.totalPoints++;
          }
        }
      }

      if (track.points.length > 0) {
        result.tracks.push(track);
      }
    }

    // Extract routes <rte> with <rtept>
    const rteRegex = /<rte[^>]*>([\s\S]*?)<\/rte>/gi;
    while ((match = rteRegex.exec(content)) !== null) {
      const routeContent = match[1];
      const route: TrackSegment = {
        name: this.extractXMLValue(routeContent, 'name'),
        points: [],
      };

      const rteptRegex = /<rtept\s+lat=["']([^"']+)["']\s+lon=["']([^"']+)["'][^>]*>([\s\S]*?)<\/rtept>/gi;
      let ptMatch;
      while ((ptMatch = rteptRegex.exec(routeContent)) !== null) {
        const point = this.parseGPXPoint(ptMatch[1], ptMatch[2], ptMatch[3]);
        if (point) {
          route.points.push(point);
          result.totalPoints++;
        }
      }

      if (route.points.length > 0) {
        result.routes.push(route);
      }
    }

    // Calculate bounds and center
    this.calculateBoundsAndCenter(result);

    return result;
  }

  /**
   * Parse a GPX point element content
   */
  private parseGPXPoint(latStr: string, lonStr: string, content: string): GPSPoint | null {
    const lat = parseFloat(latStr);
    const lng = parseFloat(lonStr);

    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return null;
    }

    const point: GPSPoint = { lat, lng };

    // Extract optional elements
    const ele = this.extractXMLValue(content, 'ele');
    if (ele) {
      const eleNum = parseFloat(ele);
      if (!isNaN(eleNum)) {
        point.ele = eleNum;
      }
    }

    const time = this.extractXMLValue(content, 'time');
    if (time) {
      point.time = time;
    }

    const name = this.extractXMLValue(content, 'name');
    if (name) {
      point.name = this.decodeXMLEntities(name);
    }

    const desc = this.extractXMLValue(content, 'desc');
    if (desc) {
      point.desc = this.decodeXMLEntities(desc);
    }

    return point;
  }

  /**
   * Parse KML (Keyhole Markup Language) content
   * KML uses: <Placemark> with <Point>, <LineString>, <Polygon>
   * Coordinates format: "lng,lat,ele lng,lat,ele ..."
   */
  private parseKML(content: string): MapFileData {
    const result: MapFileData = {
      format: 'kml',
      waypoints: [],
      tracks: [],
      routes: [],
      totalPoints: 0,
    };

    // Extract document name
    const docNameMatch = content.match(/<Document[^>]*>[\s\S]*?<name[^>]*>([\s\S]*?)<\/name>/i);
    if (docNameMatch) {
      result.name = this.decodeXMLEntities(docNameMatch[1].trim());
    }

    // Extract Placemarks
    const placemarkRegex = /<Placemark[^>]*>([\s\S]*?)<\/Placemark>/gi;
    let match;
    while ((match = placemarkRegex.exec(content)) !== null) {
      const placemarkContent = match[1];
      const name = this.extractXMLValue(placemarkContent, 'name');
      const desc = this.extractXMLValue(placemarkContent, 'description');

      // Check for Point
      const pointMatch = placemarkContent.match(/<Point[^>]*>[\s\S]*?<coordinates[^>]*>([\s\S]*?)<\/coordinates>/i);
      if (pointMatch) {
        const coords = this.parseKMLCoordinates(pointMatch[1].trim());
        if (coords.length > 0) {
          const point = coords[0];
          point.name = name ? this.decodeXMLEntities(name) : undefined;
          point.desc = desc ? this.decodeXMLEntities(desc) : undefined;
          result.waypoints.push(point);
          result.totalPoints++;
        }
      }

      // Check for LineString (track/route)
      const lineMatch = placemarkContent.match(/<LineString[^>]*>[\s\S]*?<coordinates[^>]*>([\s\S]*?)<\/coordinates>/i);
      if (lineMatch) {
        const coords = this.parseKMLCoordinates(lineMatch[1].trim());
        if (coords.length > 0) {
          result.tracks.push({
            name: name ? this.decodeXMLEntities(name) : undefined,
            points: coords,
          });
          result.totalPoints += coords.length;
        }
      }

      // Check for MultiGeometry containing LineStrings
      const multiGeoMatch = placemarkContent.match(/<MultiGeometry[^>]*>([\s\S]*?)<\/MultiGeometry>/i);
      if (multiGeoMatch) {
        const multiContent = multiGeoMatch[1];
        const lineRegex = /<LineString[^>]*>[\s\S]*?<coordinates[^>]*>([\s\S]*?)<\/coordinates>/gi;
        let lineMatch2;
        while ((lineMatch2 = lineRegex.exec(multiContent)) !== null) {
          const coords = this.parseKMLCoordinates(lineMatch2[1].trim());
          if (coords.length > 0) {
            result.tracks.push({
              name: name ? this.decodeXMLEntities(name) : undefined,
              points: coords,
            });
            result.totalPoints += coords.length;
          }
        }
      }

      // Check for Polygon (extract outer boundary)
      const polygonMatch = placemarkContent.match(/<Polygon[^>]*>[\s\S]*?<outerBoundaryIs>[\s\S]*?<coordinates[^>]*>([\s\S]*?)<\/coordinates>/i);
      if (polygonMatch) {
        const coords = this.parseKMLCoordinates(polygonMatch[1].trim());
        if (coords.length > 0) {
          result.routes.push({
            name: name ? `Polygon: ${this.decodeXMLEntities(name || '')}` : 'Polygon',
            points: coords,
          });
          result.totalPoints += coords.length;
        }
      }
    }

    // Calculate bounds and center
    this.calculateBoundsAndCenter(result);

    return result;
  }

  /**
   * Parse KML coordinate string
   * Format: "lng,lat,ele lng,lat,ele ..." or "lng,lat lng,lat ..."
   * Coordinates separated by whitespace
   */
  private parseKMLCoordinates(coordString: string): GPSPoint[] {
    const points: GPSPoint[] = [];

    // Split by whitespace (space, newline, tab)
    const coordPairs = coordString.trim().split(/\s+/);

    for (const pair of coordPairs) {
      const parts = pair.split(',');
      if (parts.length >= 2) {
        const lng = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        const ele = parts.length > 2 ? parseFloat(parts[2]) : undefined;

        if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
          const point: GPSPoint = { lat, lng };
          if (ele !== undefined && !isNaN(ele)) {
            point.ele = ele;
          }
          points.push(point);
        }
      }
    }

    return points;
  }

  /**
   * Extract value from XML element
   */
  private extractXMLValue(content: string, tagName: string): string | undefined {
    const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
    const match = content.match(regex);
    return match ? match[1].trim() : undefined;
  }

  /**
   * Decode XML entities
   */
  private decodeXMLEntities(str: string): string {
    return str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'); // Handle CDATA
  }

  /**
   * Calculate bounding box and center point from all points
   */
  private calculateBoundsAndCenter(result: MapFileData): void {
    const allPoints: GPSPoint[] = [
      ...result.waypoints,
      ...result.tracks.flatMap(t => t.points),
      ...result.routes.flatMap(r => r.points),
    ];

    if (allPoints.length === 0) {
      return;
    }

    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    let sumLat = 0, sumLng = 0;

    for (const point of allPoints) {
      minLat = Math.min(minLat, point.lat);
      maxLat = Math.max(maxLat, point.lat);
      minLng = Math.min(minLng, point.lng);
      maxLng = Math.max(maxLng, point.lng);
      sumLat += point.lat;
      sumLng += point.lng;
    }

    result.bounds = { minLat, maxLat, minLng, maxLng };
    result.centerPoint = {
      lat: sumLat / allPoints.length,
      lng: sumLng / allPoints.length,
    };
  }

  /**
   * Create empty result for unsupported formats
   */
  private createEmptyResult(format: MapFileData['format']): MapFileData {
    return {
      format,
      waypoints: [],
      tracks: [],
      routes: [],
      totalPoints: 0,
    };
  }

  /**
   * Get summary of map file data
   */
  getSummary(data: MapFileData): string {
    const parts: string[] = [];

    if (data.waypoints.length > 0) {
      parts.push(`${data.waypoints.length} waypoint${data.waypoints.length > 1 ? 's' : ''}`);
    }
    if (data.tracks.length > 0) {
      const trackPoints = data.tracks.reduce((sum, t) => sum + t.points.length, 0);
      parts.push(`${data.tracks.length} track${data.tracks.length > 1 ? 's' : ''} (${trackPoints} points)`);
    }
    if (data.routes.length > 0) {
      const routePoints = data.routes.reduce((sum, r) => sum + r.points.length, 0);
      parts.push(`${data.routes.length} route${data.routes.length > 1 ? 's' : ''} (${routePoints} points)`);
    }

    if (parts.length === 0) {
      return 'No GPS data found';
    }

    return parts.join(', ');
  }
}
