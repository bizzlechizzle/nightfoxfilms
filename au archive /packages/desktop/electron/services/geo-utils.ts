/**
 * Geographic Utility Functions
 *
 * Provides Haversine distance calculation for GPS proximity checks.
 * Used by ref-map-dedup-service for duplicate detection.
 */

/**
 * Calculate distance between two GPS coordinates in meters.
 * Uses the Haversine formula for great-circle distance on a sphere.
 *
 * @param lat1 - Latitude of first point (decimal degrees)
 * @param lng1 - Longitude of first point (decimal degrees)
 * @param lat2 - Latitude of second point (decimal degrees)
 * @param lng2 - Longitude of second point (decimal degrees)
 * @returns Distance in meters
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000; // Earth's radius in meters

  const toRad = (deg: number): number => deg * Math.PI / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Check if two GPS coordinates are within a given radius.
 *
 * @param lat1 - Latitude of first point
 * @param lng1 - Longitude of first point
 * @param lat2 - Latitude of second point
 * @param lng2 - Longitude of second point
 * @param radiusMeters - Maximum distance in meters
 * @returns True if points are within radius
 */
export function isWithinRadius(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  radiusMeters: number
): boolean {
  return haversineDistance(lat1, lng1, lat2, lng2) <= radiusMeters;
}

/**
 * Calculate approximate bounding box for a given radius around a point.
 * Used for pre-filtering database queries before exact distance calculation.
 *
 * Note: This is an approximation. At higher latitudes, longitude degrees
 * cover less distance, so we use a conservative estimate.
 *
 * @param lat - Center latitude
 * @param lng - Center longitude
 * @param radiusMeters - Radius in meters
 * @returns Bounding box { minLat, maxLat, minLng, maxLng }
 */
export function getBoundingBox(
  lat: number,
  lng: number,
  radiusMeters: number
): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  // 1 degree latitude ≈ 111,320 meters
  const latDelta = radiusMeters / 111320;

  // 1 degree longitude varies by latitude: ≈ 111,320 * cos(lat) meters
  // Use a conservative estimate (smaller cos value = larger delta)
  const lngDelta = radiusMeters / (111320 * Math.cos(lat * Math.PI / 180));

  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}
