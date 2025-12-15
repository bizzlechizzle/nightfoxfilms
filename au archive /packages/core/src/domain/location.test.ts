import { describe, it, expect } from 'vitest';
import { LocationEntity, GPSCoordinatesSchema, AddressSchema, LocationInputSchema } from './location';

// DECISION-013 & DECISION-017 & DECISION-019: Base location fixture with all required fields
// ADR-046: locid is now BLAKE3 16-char hash (not UUID, no separate loc12)
const baseLocation = {
  locid: 'a7f3b2c1e9d4f086',
  locnam: 'Test Location',
  historic: false,
  favorite: false,
  project: false,
  docInterior: false,
  docExterior: false,
  docDrone: false,
  docWebHistory: false,
  docMapFind: false,
  sublocs: [] as string[],
  regions: [] as string[],
  locadd: new Date().toISOString(),
  locationVerified: false,
  // DECISION-017: Country Cultural Region and geographic hierarchy fields
  countryCulturalRegionVerified: false,
  localCulturalRegionVerified: false,
  country: 'United States',
  continent: 'North America',
  // DECISION-019: Information Box overhaul verification fields (historicalName removed)
  locnamVerified: false,
  akanamVerified: false,
  // Per-user view tracking
  viewCount: 0,
  lastViewedAt: undefined,
  // OPT-062: Host-only location flag
  isHostOnly: false,
};

describe('LocationEntity', () => {
  describe('generateShortName', () => {
    it('should generate compact short names without hyphens', () => {
      expect(LocationEntity.generateShortName('Test (123)')).toBe('test123');
      expect(LocationEntity.generateShortName('First Baptist')).toBe('firstbaptist');
    });

    it('should remove only minimal stopwords (the, a, an)', () => {
      expect(LocationEntity.generateShortName('The Old Barn')).toBe('oldbarn');
      expect(LocationEntity.generateShortName('A Big House')).toBe('bighouse');
      // "of" and "and" are NOT stopwords - they provide context
      expect(LocationEntity.generateShortName('Hall of Fame')).toBe('halloffame');
      expect(LocationEntity.generateShortName('Peter and Paul')).toBe('peterandpaul');
    });

    it('should keep location-type words (they are part of identity)', () => {
      expect(LocationEntity.generateShortName('Old Factory')).toBe('oldfactory');
      expect(LocationEntity.generateShortName("O'Brien's Mill")).toBe('obriensmill');
      expect(LocationEntity.generateShortName('Medley Centre')).toBe('medleycenter');
    });

    it('should normalize British to American spellings', () => {
      expect(LocationEntity.generateShortName('Medley Centre')).toBe('medleycenter');
      expect(LocationEntity.generateShortName('Old Theatre')).toBe('oldtheater');
    });

    it('should handle special characters', () => {
      expect(LocationEntity.generateShortName('Factory @ Main')).toBe('factorymain');
    });

    it('should truncate to 12 characters', () => {
      const longName = 'This is a very long location name';
      const result = LocationEntity.generateShortName(longName);
      expect(result.length).toBeLessThanOrEqual(12);
      // "St. Peter & Paul Catholic Church" → slugify converts & to "and" → truncates to 12
      expect(LocationEntity.generateShortName('St. Peter & Paul Catholic Church')).toBe('stpeterandpa');
    });

    it('should fall back to original slug if all words filtered', () => {
      // Edge case: if name is just "The" or "A"
      expect(LocationEntity.generateShortName('The')).toBe('the');
    });
  });

  // ADR-046: generateLoc12 removed - locid is now BLAKE3 16-char hash
  // Use generateLocationId() from crypto-service.ts instead

  describe('getGPSConfidence', () => {
    it('should return verified for user map click with verification', () => {
      const location = {
        ...baseLocation,
        gps: {
          lat: 40.7128,
          lng: -74.0060,
          source: 'user_map_click' as const,
          verifiedOnMap: true
        },
      };
      const entity = new LocationEntity(location);
      expect(entity.getGPSConfidence()).toBe('verified');
    });

    it('should return high for photo EXIF with good accuracy', () => {
      const location = {
        ...baseLocation,
        gps: {
          lat: 40.7128,
          lng: -74.0060,
          source: 'photo_exif' as const,
          verifiedOnMap: false,
          accuracy: 5
        },
      };
      const entity = new LocationEntity(location);
      expect(entity.getGPSConfidence()).toBe('high');
    });

    it('should return medium for geocoded address', () => {
      const location = {
        ...baseLocation,
        gps: {
          lat: 40.7128,
          lng: -74.0060,
          source: 'geocoded_address' as const,
          verifiedOnMap: false
        },
      };
      const entity = new LocationEntity(location);
      expect(entity.getGPSConfidence()).toBe('medium');
    });

    it('should return none for no GPS data', () => {
      const location = { ...baseLocation };
      const entity = new LocationEntity(location);
      expect(entity.getGPSConfidence()).toBe('none');
    });
  });

  describe('hasValidGPS', () => {
    it('should return true for valid GPS coordinates', () => {
      const location = {
        ...baseLocation,
        gps: {
          lat: 40.7128,
          lng: -74.0060,
          source: 'user_map_click' as const,
          verifiedOnMap: true
        },
      };
      const entity = new LocationEntity(location);
      expect(entity.hasValidGPS()).toBe(true);
    });

    it('should return false for invalid latitude', () => {
      const location = {
        ...baseLocation,
        gps: {
          lat: 91,
          lng: -74.0060,
          source: 'user_map_click' as const,
          verifiedOnMap: true
        },
      };
      const entity = new LocationEntity(location);
      expect(entity.hasValidGPS()).toBe(false);
    });

    it('should return false for no GPS data', () => {
      const location = { ...baseLocation };
      const entity = new LocationEntity(location);
      expect(entity.hasValidGPS()).toBe(false);
    });
  });
});

describe('Zod Schemas', () => {
  describe('GPSCoordinatesSchema', () => {
    it('should validate valid GPS coordinates', () => {
      const validGPS = {
        lat: 40.7128,
        lng: -74.0060,
        source: 'user_map_click'
      };
      const result = GPSCoordinatesSchema.safeParse(validGPS);
      expect(result.success).toBe(true);
    });

    it('should reject invalid latitude', () => {
      const invalidGPS = {
        lat: 100,
        lng: -74.0060,
        source: 'user_map_click'
      };
      const result = GPSCoordinatesSchema.safeParse(invalidGPS);
      expect(result.success).toBe(false);
    });

    it('should reject invalid source', () => {
      const invalidGPS = {
        lat: 40.7128,
        lng: -74.0060,
        source: 'invalid_source'
      };
      const result = GPSCoordinatesSchema.safeParse(invalidGPS);
      expect(result.success).toBe(false);
    });
  });

  describe('AddressSchema', () => {
    it('should validate valid address', () => {
      const validAddress = {
        street: '123 Main St',
        city: 'New York',
        state: 'NY',
        zipcode: '10001'
      };
      const result = AddressSchema.safeParse(validAddress);
      expect(result.success).toBe(true);
    });

    it('should reject invalid state code', () => {
      const invalidAddress = {
        state: 'NEW'
      };
      const result = AddressSchema.safeParse(invalidAddress);
      expect(result.success).toBe(false);
    });

    it('should reject invalid zipcode format', () => {
      const invalidAddress = {
        zipcode: '123'
      };
      const result = AddressSchema.safeParse(invalidAddress);
      expect(result.success).toBe(false);
    });
  });

  describe('LocationInputSchema', () => {
    it('should validate minimum required fields', () => {
      const validInput = {
        locnam: 'Test Location'
      };
      const result = LocationInputSchema.safeParse(validInput);
      expect(result.success).toBe(true);
    });

    it('should reject empty location name', () => {
      const invalidInput = {
        locnam: ''
      };
      const result = LocationInputSchema.safeParse(invalidInput);
      expect(result.success).toBe(false);
    });
  });
});
