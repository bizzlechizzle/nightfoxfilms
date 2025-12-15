/**
 * GPS validation and distance calculation service
 */

/**
 * Location GPS metadata for confidence checking
 */
export interface LocationGPSInfo {
  gps_lat?: number | null;
  gps_lng?: number | null;
  gps_source?: string | null;
  gps_verified_on_map?: boolean | number | null;
  gps_geocode_tier?: number | null;
}

export class GPSValidator {
  /**
   * Determine if GPS mismatch checking should be performed for a location.
   *
   * Skip mismatch warnings for low-confidence GPS:
   * - gps_geocode_tier === 5 (state-only geocoding - ~100km expected accuracy)
   * - gps_source === null (no GPS set at all)
   * - gps_source === 'geocoded_address' AND gps_verified_on_map === false
   *
   * This prevents false mismatch warnings when comparing precise image EXIF GPS
   * against imprecise state-center geocoded coordinates.
   */
  static shouldCheckMismatch(location: LocationGPSInfo): boolean {
    // No GPS at all - nothing to compare against
    if (!location.gps_lat || !location.gps_lng) {
      return false;
    }

    // No source recorded - treat as unreliable
    if (!location.gps_source) {
      return false;
    }

    // State-only geocoding (tier 5) has ~100km expected accuracy
    // 10km threshold is inappropriate for this level of precision
    if (location.gps_geocode_tier === 5) {
      return false;
    }

    // Geocoded address that hasn't been verified on map
    // User hasn't confirmed the geocoded location is accurate
    const isVerified = location.gps_verified_on_map === true || location.gps_verified_on_map === 1;
    if (location.gps_source === 'geocoded_address' && !isVerified) {
      return false;
    }

    // GPS is precise enough - check for mismatch
    return true;
  }

  /**
   * Check if location should auto-adopt GPS from imported media.
   *
   * DECISION-010: Simplified logic per user requirement:
   * - Auto-adopt ONLY if location has NO GPS at all
   * - NEVER touch verified GPS (protected)
   * - All other cases: return false (prompt user instead)
   *
   * Returns true ONLY if:
   * - Location has no GPS at all (gps_lat/gps_lng are null)
   */
  static shouldAdoptMediaGPS(location: LocationGPSInfo): boolean {
    // PROTECTED: Never auto-adopt if GPS is verified
    const isVerified = location.gps_verified_on_map === true || location.gps_verified_on_map === 1;
    if (isVerified) {
      return false;
    }

    // Only auto-adopt if location has NO GPS at all
    if (!location.gps_lat || !location.gps_lng) {
      return true;
    }

    // All other cases: DO NOT auto-adopt
    // This includes tier 5 (state-only), unverified geocoded addresses, etc.
    // User should be prompted to confirm GPS adoption
    return false;
  }
  /**
   * Calculate Haversine distance between two GPS coordinates (in meters)
   * Formula: a = sin²(Δφ/2) + cos φ1 * cos φ2 * sin²(Δλ/2)
   *          c = 2 * atan2( √a, √(1−a) )
   *          d = R * c
   */
  static haversineDistance(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number
  ): number {
    const R = 6371000; // Earth radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lng2 - lng1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  }

  /**
   * Check if GPS coordinates are valid
   */
  static isValidGPS(lat: number | null, lng: number | null): boolean {
    if (lat === null || lng === null) {
      return false;
    }

    return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  }

  /**
   * Check if GPS coordinates differ significantly (> threshold)
   * Returns object with mismatch flag and distance
   */
  static checkGPSMismatch(
    locationGPS: { lat: number | null; lng: number | null },
    mediaGPS: { lat: number | null; lng: number | null },
    thresholdMeters: number = 10000 // 10km default
  ): { mismatch: boolean; distance: number | null; severity: 'none' | 'minor' | 'major' } {
    // If either GPS is missing, no mismatch
    if (!this.isValidGPS(locationGPS.lat, locationGPS.lng)) {
      return { mismatch: false, distance: null, severity: 'none' };
    }

    if (!this.isValidGPS(mediaGPS.lat, mediaGPS.lng)) {
      return { mismatch: false, distance: null, severity: 'none' };
    }

    const distance = this.haversineDistance(
      locationGPS.lat!,
      locationGPS.lng!,
      mediaGPS.lat!,
      mediaGPS.lng!
    );

    // Classify severity
    let severity: 'none' | 'minor' | 'major' = 'none';
    if (distance > thresholdMeters) {
      severity = 'major'; // > 10km
    } else if (distance > 1000) {
      severity = 'minor'; // > 1km
    }

    return {
      mismatch: distance > thresholdMeters,
      distance,
      severity,
    };
  }

  /**
   * Format distance for display
   */
  static formatDistance(meters: number): string {
    if (meters < 1000) {
      return `${Math.round(meters)}m`;
    }
    return `${(meters / 1000).toFixed(2)}km`;
  }
}
