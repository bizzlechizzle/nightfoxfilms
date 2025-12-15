import { describe, it, expect } from 'vitest';
import { AddressNormalizer } from '../../services/address-normalizer';

describe('AddressNormalizer', () => {
  describe('normalizeStateCode', () => {
    it('should return valid 2-letter state code unchanged', () => {
      expect(AddressNormalizer.normalizeStateCode('NY')).toBe('NY');
      expect(AddressNormalizer.normalizeStateCode('CA')).toBe('CA');
      expect(AddressNormalizer.normalizeStateCode('TX')).toBe('TX');
    });

    it('should convert lowercase state codes to uppercase', () => {
      expect(AddressNormalizer.normalizeStateCode('ny')).toBe('NY');
      expect(AddressNormalizer.normalizeStateCode('ca')).toBe('CA');
    });

    it('should convert full state names to codes', () => {
      expect(AddressNormalizer.normalizeStateCode('New York')).toBe('NY');
      expect(AddressNormalizer.normalizeStateCode('California')).toBe('CA');
      expect(AddressNormalizer.normalizeStateCode('texas')).toBe('TX');
      expect(AddressNormalizer.normalizeStateCode('FLORIDA')).toBe('FL');
    });

    it('should handle edge cases', () => {
      expect(AddressNormalizer.normalizeStateCode('')).toBe(null);
      expect(AddressNormalizer.normalizeStateCode(null)).toBe(null);
      expect(AddressNormalizer.normalizeStateCode(undefined)).toBe(null);
      expect(AddressNormalizer.normalizeStateCode('   ')).toBe(null);
    });

    it('should return null for invalid state codes', () => {
      expect(AddressNormalizer.normalizeStateCode('XX')).toBe(null);
      expect(AddressNormalizer.normalizeStateCode('AB')).toBe(null);
      expect(AddressNormalizer.normalizeStateCode('Unknown State')).toBe(null);
    });

    it('should handle whitespace', () => {
      expect(AddressNormalizer.normalizeStateCode('  NY  ')).toBe('NY');
      expect(AddressNormalizer.normalizeStateCode('  New York  ')).toBe('NY');
    });
  });

  describe('normalizeZipcode', () => {
    it('should return valid 5-digit zipcodes unchanged', () => {
      expect(AddressNormalizer.normalizeZipcode('12345')).toBe('12345');
      expect(AddressNormalizer.normalizeZipcode('00000')).toBe('00000');
    });

    it('should format 9-digit zipcodes correctly', () => {
      expect(AddressNormalizer.normalizeZipcode('123456789')).toBe('12345-6789');
      expect(AddressNormalizer.normalizeZipcode('12345-6789')).toBe('12345-6789');
    });

    it('should handle various formats', () => {
      expect(AddressNormalizer.normalizeZipcode('12345 6789')).toBe('12345-6789');
      expect(AddressNormalizer.normalizeZipcode('12345  6789')).toBe('12345-6789');
    });

    it('should handle edge cases', () => {
      expect(AddressNormalizer.normalizeZipcode('')).toBe(null);
      expect(AddressNormalizer.normalizeZipcode(null)).toBe(null);
      expect(AddressNormalizer.normalizeZipcode(undefined)).toBe(null);
    });

    it('should extract 5 digits from longer strings', () => {
      expect(AddressNormalizer.normalizeZipcode('123456')).toBe('12345');
      expect(AddressNormalizer.normalizeZipcode('12345abcd')).toBe('12345');
    });
  });

  describe('normalizeStreet', () => {
    it('should trim whitespace', () => {
      expect(AddressNormalizer.normalizeStreet('  123 Main St  ')).toBe('123 Main St');
    });

    it('should collapse multiple spaces', () => {
      expect(AddressNormalizer.normalizeStreet('123  Main    St')).toBe('123 Main St');
    });

    it('should handle edge cases', () => {
      expect(AddressNormalizer.normalizeStreet('')).toBe(null);
      expect(AddressNormalizer.normalizeStreet(null)).toBe(null);
      expect(AddressNormalizer.normalizeStreet(undefined)).toBe(null);
      expect(AddressNormalizer.normalizeStreet('   ')).toBe(null);
    });
  });

  describe('normalizeCity', () => {
    it('should title case city names', () => {
      expect(AddressNormalizer.normalizeCity('new york')).toBe('New York');
      expect(AddressNormalizer.normalizeCity('SAN FRANCISCO')).toBe('San Francisco');
    });

    it('should trim whitespace', () => {
      expect(AddressNormalizer.normalizeCity('  Albany  ')).toBe('Albany');
    });

    it('should handle edge cases', () => {
      expect(AddressNormalizer.normalizeCity('')).toBe(null);
      expect(AddressNormalizer.normalizeCity(null)).toBe(null);
      expect(AddressNormalizer.normalizeCity(undefined)).toBe(null);
    });
  });

  describe('normalizeCounty', () => {
    it('should remove " County" suffix', () => {
      expect(AddressNormalizer.normalizeCounty('Albany County')).toBe('Albany');
      expect(AddressNormalizer.normalizeCounty('Saratoga county')).toBe('Saratoga');
    });

    it('should title case county names', () => {
      expect(AddressNormalizer.normalizeCounty('saratoga')).toBe('Saratoga');
    });

    it('should handle edge cases', () => {
      expect(AddressNormalizer.normalizeCounty('')).toBe(null);
      expect(AddressNormalizer.normalizeCounty(null)).toBe(null);
    });
  });

  describe('normalizeAddress', () => {
    it('should normalize a complete address from geocoding', () => {
      const result = AddressNormalizer.normalizeAddress({
        street: '123 main street',
        city: 'albany',
        county: 'Albany County',
        state: 'New York',
        stateCode: 'NY',
        zipcode: '12207',
      }, 'high');

      expect(result.street).toBe('123 main street');
      expect(result.city).toBe('Albany');
      expect(result.county).toBe('Albany');
      expect(result.state).toBe('NY');
      expect(result.zipcode).toBe('12207');
      expect(result.confidence).toBe('high');
    });

    it('should prefer stateCode over state name', () => {
      const result = AddressNormalizer.normalizeAddress({
        state: 'New York',
        stateCode: 'NY',
      });

      expect(result.state).toBe('NY');
    });

    it('should fall back to state name if no stateCode', () => {
      const result = AddressNormalizer.normalizeAddress({
        state: 'California',
      });

      expect(result.state).toBe('CA');
    });

    it('should combine house number and street', () => {
      const result = AddressNormalizer.normalizeAddress({
        houseNumber: '123',
        street: 'Main St',
      });

      expect(result.street).toBe('123 Main St');
    });
  });

  describe('isValidAddress', () => {
    it('should return true if address has state', () => {
      expect(AddressNormalizer.isValidAddress({
        street: null,
        city: null,
        county: null,
        state: 'NY',
        zipcode: null,
        confidence: 'medium',
        geocodedAt: null,
      })).toBe(true);
    });

    it('should return true if address has city and zipcode', () => {
      expect(AddressNormalizer.isValidAddress({
        street: null,
        city: 'Albany',
        county: null,
        state: null,
        zipcode: '12207',
        confidence: 'medium',
        geocodedAt: null,
      })).toBe(true);
    });

    it('should return false if insufficient data', () => {
      expect(AddressNormalizer.isValidAddress({
        street: '123 Main St',
        city: null,
        county: null,
        state: null,
        zipcode: null,
        confidence: 'low',
        geocodedAt: null,
      })).toBe(false);
    });
  });

  describe('formatAddress', () => {
    it('should format a complete address', () => {
      expect(AddressNormalizer.formatAddress({
        street: '123 Main St',
        city: 'Albany',
        county: 'Albany',
        state: 'NY',
        zipcode: '12207',
        confidence: 'high',
        geocodedAt: null,
      })).toBe('123 Main St, Albany, NY 12207');
    });

    it('should handle missing components', () => {
      expect(AddressNormalizer.formatAddress({
        street: null,
        city: 'Albany',
        county: null,
        state: 'NY',
        zipcode: null,
        confidence: 'medium',
        geocodedAt: null,
      })).toBe('Albany, NY');
    });
  });

  describe('parseAddressString', () => {
    it('should parse "City, State Zip" format', () => {
      const result = AddressNormalizer.parseAddressString('Albany, NY 12207');
      expect(result.city).toBe('Albany');
      expect(result.state).toBe('NY');
      expect(result.zipcode).toBe('12207');
    });

    it('should parse "Street, City, State Zip" format', () => {
      const result = AddressNormalizer.parseAddressString('123 Main St, Albany, NY 12207');
      expect(result.street).toBe('123 Main St');
      expect(result.city).toBe('Albany');
      expect(result.state).toBe('NY');
      expect(result.zipcode).toBe('12207');
    });

    it('should handle empty input', () => {
      expect(AddressNormalizer.parseAddressString('')).toEqual({});
    });
  });
});
