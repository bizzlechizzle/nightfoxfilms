/**
 * OPT-044: Unit tests for Map.svelte hash computation utilities
 * OPT-045: Added tests for shouldUseSimpleMarkers clustering threshold
 *
 * These tests verify that getLocationsHash correctly handles both:
 * - Location type (with gps.lat, gps.lng)
 * - MapLocation type (with gps_lat, gps_lng)
 *
 * The old implementation only handled Location type, causing re-render storms
 * when MapLocation was passed (always produced 0:0 for coordinates).
 */
import { describe, it, expect } from 'vitest';

// Type definitions matching the actual component types
interface LocationGps {
  lat: number;
  lng: number;
  accuracy?: number;
  source?: string;
  verifiedOnMap?: boolean;
}

interface Location {
  locid: string;
  locnam: string;
  category?: string;
  gps?: LocationGps;
}

interface MapLocation {
  locid: string;
  locnam: string;
  category?: string;
  gps_lat: number;
  gps_lng: number;
  gps_accuracy?: number;
  gps_source?: string;
  gps_verified_on_map: boolean;
  address_state?: string;
  address_city?: string;
  favorite: boolean;
}

/**
 * Helper to detect MapLocation type (mirrors Map.svelte implementation)
 */
function isMapLocation(loc: Location | MapLocation): loc is MapLocation {
  return 'gps_lat' in loc && 'gps_lng' in loc;
}

/**
 * Get coordinates from either Location or MapLocation type
 * (mirrors Map.svelte getCoordinatesFromAny implementation)
 */
function getCoordinatesFromAny(loc: Location | MapLocation): { lat: number; lng: number } | null {
  if (isMapLocation(loc)) {
    if (loc.gps_lat != null && loc.gps_lng != null) {
      return { lat: loc.gps_lat, lng: loc.gps_lng };
    }
    return null;
  }
  // Location type
  if (loc.gps?.lat != null && loc.gps?.lng != null) {
    return { lat: loc.gps.lat, lng: loc.gps.lng };
  }
  return null;
}

/**
 * FIXED implementation of getLocationsHash
 * Handles both Location and MapLocation types correctly
 */
function getLocationsHash(locs: (Location | MapLocation)[]): string {
  return locs.map((l) => {
    const coords = getCoordinatesFromAny(l);
    return `${l.locid}:${coords?.lat ?? 0}:${coords?.lng ?? 0}`;
  }).join(',');
}

/**
 * OLD BROKEN implementation (for regression testing)
 * This only works with Location type, not MapLocation
 */
function getLocationsHashOLD(locs: Location[]): string {
  return locs.map(l => `${l.locid}:${l.gps?.lat || 0}:${l.gps?.lng || 0}`).join(',');
}

describe('Map Hash Utilities', () => {
  describe('getLocationsHash', () => {
    it('should generate hash for Location type (gps.lat/lng)', () => {
      const locations: Location[] = [
        { locid: 'loc1', locnam: 'Location 1', gps: { lat: 42.5, lng: -73.7 } },
        { locid: 'loc2', locnam: 'Location 2', gps: { lat: 41.0, lng: -74.0 } },
      ];

      const hash = getLocationsHash(locations);

      expect(hash).toBe('loc1:42.5:-73.7,loc2:41:-74');
      expect(hash).not.toContain(':0:0'); // Should NOT have fallback zeros
    });

    it('should generate hash for MapLocation type (gps_lat/gps_lng)', () => {
      const mapLocations: MapLocation[] = [
        {
          locid: 'loc1',
          locnam: 'Location 1',
          gps_lat: 42.5,
          gps_lng: -73.7,
          gps_verified_on_map: true,
          favorite: false,
        },
        {
          locid: 'loc2',
          locnam: 'Location 2',
          gps_lat: 41.0,
          gps_lng: -74.0,
          gps_verified_on_map: false,
          favorite: true,
        },
      ];

      const hash = getLocationsHash(mapLocations);

      expect(hash).toBe('loc1:42.5:-73.7,loc2:41:-74');
      expect(hash).not.toContain(':0:0'); // Should NOT have fallback zeros
    });

    it('should produce equivalent hashes for same coordinates in different types', () => {
      const location: Location = {
        locid: 'test',
        locnam: 'Test Location',
        gps: { lat: 42.6526, lng: -73.7562 },
      };

      const mapLocation: MapLocation = {
        locid: 'test',
        locnam: 'Test Location',
        gps_lat: 42.6526,
        gps_lng: -73.7562,
        gps_verified_on_map: true,
        favorite: false,
      };

      const hashLocation = getLocationsHash([location]);
      const hashMapLocation = getLocationsHash([mapLocation]);

      expect(hashLocation).toBe(hashMapLocation);
      expect(hashLocation).toBe('test:42.6526:-73.7562');
    });

    it('should produce different hashes for different coordinates', () => {
      const loc1: MapLocation = {
        locid: 'same',
        locnam: 'Same ID',
        gps_lat: 42.0,
        gps_lng: -73.0,
        gps_verified_on_map: true,
        favorite: false,
      };

      const loc2: MapLocation = {
        locid: 'same',
        locnam: 'Same ID',
        gps_lat: 43.0, // Different lat
        gps_lng: -73.0,
        gps_verified_on_map: true,
        favorite: false,
      };

      const hash1 = getLocationsHash([loc1]);
      const hash2 = getLocationsHash([loc2]);

      expect(hash1).not.toBe(hash2);
    });

    it('should produce stable hashes for unchanged data', () => {
      const locations: MapLocation[] = [
        {
          locid: 'loc1',
          locnam: 'Location 1',
          gps_lat: 42.5,
          gps_lng: -73.7,
          gps_verified_on_map: true,
          favorite: false,
        },
      ];

      const hash1 = getLocationsHash(locations);
      const hash2 = getLocationsHash(locations);

      expect(hash1).toBe(hash2);
    });

    it('should handle empty array', () => {
      const hash = getLocationsHash([]);
      expect(hash).toBe('');
    });

    it('should handle location with null GPS (fallback to 0)', () => {
      const location: Location = {
        locid: 'no-gps',
        locnam: 'No GPS Location',
        // No gps property
      };

      const hash = getLocationsHash([location]);

      expect(hash).toBe('no-gps:0:0');
    });
  });

  describe('regression: old implementation fails with MapLocation', () => {
    it('OLD implementation produces wrong hash for MapLocation (all zeros)', () => {
      const mapLocation: MapLocation = {
        locid: 'test',
        locnam: 'Test',
        gps_lat: 42.5,
        gps_lng: -73.7,
        gps_verified_on_map: true,
        favorite: false,
      };

      // Cast to Location[] to simulate old behavior
      // The old implementation would try to access .gps.lat which doesn't exist
      const oldHash = getLocationsHashOLD([mapLocation as unknown as Location]);

      // OLD implementation produces zeros because gps.lat doesn't exist on MapLocation
      expect(oldHash).toBe('test:0:0');

      // NEW implementation correctly handles MapLocation
      const newHash = getLocationsHash([mapLocation]);
      expect(newHash).toBe('test:42.5:-73.7');

      // They are different - this is the bug we fixed!
      expect(oldHash).not.toBe(newHash);
    });
  });

  describe('isMapLocation type guard', () => {
    it('should correctly identify MapLocation type', () => {
      const mapLoc: MapLocation = {
        locid: 'test',
        locnam: 'Test',
        gps_lat: 0,
        gps_lng: 0,
        gps_verified_on_map: false,
        favorite: false,
      };

      expect(isMapLocation(mapLoc)).toBe(true);
    });

    it('should correctly identify Location type', () => {
      const location: Location = {
        locid: 'test',
        locnam: 'Test',
        gps: { lat: 0, lng: 0 },
      };

      expect(isMapLocation(location)).toBe(false);
    });
  });

  /**
   * OPT-045: Tests for shouldUseSimpleMarkers threshold logic
   * Small datasets (≤100) should skip clustering for instant rendering
   */
  describe('shouldUseSimpleMarkers', () => {
    const SIMPLE_MARKER_THRESHOLD = 100;

    function shouldUseSimpleMarkers(locationsLength: number): boolean {
      return locationsLength <= SIMPLE_MARKER_THRESHOLD;
    }

    it('should return true for empty array', () => {
      expect(shouldUseSimpleMarkers(0)).toBe(true);
    });

    it('should return true for 1 location', () => {
      expect(shouldUseSimpleMarkers(1)).toBe(true);
    });

    it('should return true for 11 locations (typical small dataset)', () => {
      expect(shouldUseSimpleMarkers(11)).toBe(true);
    });

    it('should return true for exactly 100 locations (threshold)', () => {
      expect(shouldUseSimpleMarkers(100)).toBe(true);
    });

    it('should return false for 101 locations (above threshold)', () => {
      expect(shouldUseSimpleMarkers(101)).toBe(false);
    });

    it('should return false for 500 locations (large dataset)', () => {
      expect(shouldUseSimpleMarkers(500)).toBe(false);
    });

    it('should return false for 1000 locations (very large dataset)', () => {
      expect(shouldUseSimpleMarkers(1000)).toBe(false);
    });
  });
});
