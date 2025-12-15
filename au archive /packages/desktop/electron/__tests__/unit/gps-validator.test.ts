import { describe, it, expect } from 'vitest';
import { GPSValidator } from '../../services/gps-validator';

describe('GPSValidator', () => {
  describe('isValidGPS', () => {
    it('should validate correct GPS coordinates', () => {
      expect(GPSValidator.isValidGPS(0, 0)).toBe(true);
      expect(GPSValidator.isValidGPS(45.5, -122.6)).toBe(true);
      expect(GPSValidator.isValidGPS(-33.8, 151.2)).toBe(true);
      expect(GPSValidator.isValidGPS(90, 180)).toBe(true);
      expect(GPSValidator.isValidGPS(-90, -180)).toBe(true);
    });

    it('should reject null coordinates', () => {
      expect(GPSValidator.isValidGPS(null, 0)).toBe(false);
      expect(GPSValidator.isValidGPS(0, null)).toBe(false);
      expect(GPSValidator.isValidGPS(null, null)).toBe(false);
    });

    it('should reject out-of-bounds latitude', () => {
      expect(GPSValidator.isValidGPS(91, 0)).toBe(false);
      expect(GPSValidator.isValidGPS(-91, 0)).toBe(false);
      expect(GPSValidator.isValidGPS(100, 50)).toBe(false);
    });

    it('should reject out-of-bounds longitude', () => {
      expect(GPSValidator.isValidGPS(0, 181)).toBe(false);
      expect(GPSValidator.isValidGPS(0, -181)).toBe(false);
      expect(GPSValidator.isValidGPS(45, 200)).toBe(false);
    });
  });

  describe('haversineDistance', () => {
    it('should calculate zero distance for same coordinates', () => {
      const distance = GPSValidator.haversineDistance(45.5, -122.6, 45.5, -122.6);
      expect(distance).toBe(0);
    });

    it('should calculate distance between two known points', () => {
      // Distance from Portland, OR to Seattle, WA (~233km)
      const portland = { lat: 45.5152, lng: -122.6784 };
      const seattle = { lat: 47.6062, lng: -122.3321 };

      const distance = GPSValidator.haversineDistance(
        portland.lat,
        portland.lng,
        seattle.lat,
        seattle.lng
      );

      // Should be approximately 233km (233000 meters)
      expect(distance).toBeGreaterThan(230000);
      expect(distance).toBeLessThan(240000);
    });

    it('should calculate distance between antipodal points', () => {
      // Opposite sides of the earth should be ~20000km
      const distance = GPSValidator.haversineDistance(0, 0, 0, 180);
      expect(distance).toBeGreaterThan(19000000);
      expect(distance).toBeLessThan(21000000);
    });

    it('should calculate correct distance for short distances', () => {
      // 1 degree latitude is approximately 111km
      const distance = GPSValidator.haversineDistance(0, 0, 1, 0);
      expect(distance).toBeGreaterThan(110000);
      expect(distance).toBeLessThan(112000);
    });
  });

  describe('checkGPSMismatch', () => {
    it('should return no mismatch for close coordinates (< 1km)', () => {
      const result = GPSValidator.checkGPSMismatch(
        { lat: 45.5, lng: -122.6 },
        { lat: 45.501, lng: -122.601 },
        10000
      );

      expect(result.mismatch).toBe(false);
      expect(result.severity).toBe('none');
      expect(result.distance).toBeGreaterThan(0);
      expect(result.distance!).toBeLessThan(1000);
    });

    it('should return minor mismatch for distances > 1km but < 10km', () => {
      const result = GPSValidator.checkGPSMismatch(
        { lat: 45.5, lng: -122.6 },
        { lat: 45.55, lng: -122.6 },
        10000
      );

      expect(result.mismatch).toBe(false); // Not over threshold
      expect(result.severity).toBe('minor');
      expect(result.distance).toBeGreaterThan(1000);
      expect(result.distance!).toBeLessThan(10000);
    });

    it('should return major mismatch for distances > 10km', () => {
      const result = GPSValidator.checkGPSMismatch(
        { lat: 45.5, lng: -122.6 },
        { lat: 46.0, lng: -122.6 },
        10000
      );

      expect(result.mismatch).toBe(true);
      expect(result.severity).toBe('major');
      expect(result.distance).toBeGreaterThan(10000);
    });

    it('should return no mismatch when either GPS is invalid', () => {
      const result1 = GPSValidator.checkGPSMismatch(
        { lat: null, lng: null },
        { lat: 45.5, lng: -122.6 },
        10000
      );
      expect(result1.mismatch).toBe(false);
      expect(result1.distance).toBeNull();

      const result2 = GPSValidator.checkGPSMismatch(
        { lat: 45.5, lng: -122.6 },
        { lat: null, lng: null },
        10000
      );
      expect(result2.mismatch).toBe(false);
      expect(result2.distance).toBeNull();
    });
  });

  describe('formatDistance', () => {
    it('should format meters for distances < 1km', () => {
      expect(GPSValidator.formatDistance(500)).toBe('500m');
      expect(GPSValidator.formatDistance(999)).toBe('999m');
      expect(GPSValidator.formatDistance(0)).toBe('0m');
    });

    it('should format kilometers for distances >= 1km', () => {
      expect(GPSValidator.formatDistance(1000)).toBe('1.00km');
      expect(GPSValidator.formatDistance(1500)).toBe('1.50km');
      expect(GPSValidator.formatDistance(10000)).toBe('10.00km');
      expect(GPSValidator.formatDistance(233567)).toBe('233.57km');
    });
  });
});
