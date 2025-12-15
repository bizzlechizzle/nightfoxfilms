/**
 * Region Gap Coverage Tests
 *
 * Validates that all 8 region fields are populated (no gaps)
 * across all 50 states + DC + territories
 */

import { describe, it, expect } from 'vitest';
import {
  calculateCompleteRegionFields,
  type CompleteRegionFields,
} from './region-service';
import {
  STATE_CENTERS,
  STATE_CULTURAL_REGIONS,
  COUNTY_TO_CULTURAL_REGION,
} from '../../src/lib/census-regions';

// All states + DC + territories to test
const ALL_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC', 'PR', 'VI', 'GU',
];

/**
 * Check that a result has no gaps (no "—" placeholders)
 */
function hasNoGaps(result: CompleteRegionFields): boolean {
  return (
    result.county !== '—' &&
    result.culturalRegion !== '—' &&
    result.stateDirection !== '—' &&
    result.stateName !== '—' &&
    result.countryCulturalRegion !== '—' &&
    result.censusRegion !== '—' &&
    result.country !== '—' &&
    result.continent !== '—'
  );
}

describe('Region Gap Coverage', () => {
  describe('Full Data (GPS + Address)', () => {
    for (const state of ALL_STATES) {
      const center = STATE_CENTERS[state];
      const countyMapping = COUNTY_TO_CULTURAL_REGION[state];
      const firstCounty = countyMapping ? Object.keys(countyMapping)[0] : null;

      if (center) {
        it(`${state}: should have no gaps with GPS + address`, () => {
          const result = calculateCompleteRegionFields({
            state,
            addressState: state,
            county: firstCounty || undefined,
            addressCounty: firstCounty || undefined,
            lat: center.lat,
            lng: center.lng,
          });

          expect(result.hasGaps).toBe(false);
          expect(hasNoGaps(result)).toBe(true);
        });
      }
    }
  });

  describe('GPS Only', () => {
    for (const state of ALL_STATES) {
      const center = STATE_CENTERS[state];

      if (center) {
        it(`${state}: should populate most fields with GPS only`, () => {
          const result = calculateCompleteRegionFields({
            lat: center.lat,
            lng: center.lng,
          });

          // GPS only should still populate country cultural region
          expect(result.countryCulturalRegion).not.toBe('—');
          expect(result.country).toBe('United States');
          expect(result.continent).toBe('North America');
        });
      }
    }
  });

  describe('Address Only (State + County)', () => {
    for (const state of ALL_STATES) {
      const countyMapping = COUNTY_TO_CULTURAL_REGION[state];
      const firstCounty = countyMapping ? Object.keys(countyMapping)[0] : null;

      it(`${state}: should populate fields with state + county`, () => {
        const result = calculateCompleteRegionFields({
          state,
          addressState: state,
          county: firstCounty || undefined,
          addressCounty: firstCounty || undefined,
        });

        // With state, we should have: censusRegion, stateDirection (Central), stateName
        expect(result.stateName).not.toBe('—');
        expect(result.censusRegion).not.toBe('—');
        expect(result.stateDirection).not.toBe('—');

        // Country cultural region should use state default
        expect(result.countryCulturalRegion).not.toBe('—');
      });
    }
  });

  describe('State Only', () => {
    for (const state of ALL_STATES) {
      it(`${state}: should populate region fields with state only`, () => {
        const result = calculateCompleteRegionFields({
          state,
          addressState: state,
        });

        // With just state, we should have these populated
        expect(result.stateName).not.toBe('—');
        expect(result.censusRegion).not.toBe('—');
        expect(result.stateDirection).toContain('Central'); // Fallback
        expect(result.countryCulturalRegion).not.toBe('—'); // State default
      });
    }
  });

  describe('Cultural Region Coverage', () => {
    it('should have cultural regions for all states', () => {
      for (const state of ALL_STATES) {
        const regions = STATE_CULTURAL_REGIONS[state];
        expect(regions, `${state} should have cultural regions`).toBeDefined();
        expect(regions.length, `${state} should have at least one cultural region`).toBeGreaterThan(0);
      }
    });
  });

  describe('County Coverage', () => {
    it('should have county mappings for all states', () => {
      for (const state of ALL_STATES) {
        const mapping = COUNTY_TO_CULTURAL_REGION[state];
        expect(mapping, `${state} should have county mapping`).toBeDefined();
        expect(Object.keys(mapping).length, `${state} should have at least one county`).toBeGreaterThan(0);
      }
    });
  });

  describe('Edge Cases', () => {
    it('DC: should have cultural regions', () => {
      const dcRegions = STATE_CULTURAL_REGIONS['DC'];
      expect(dcRegions).toBeDefined();
      expect(dcRegions.length).toBeGreaterThan(0);
    });

    it('PR: should have cultural regions', () => {
      const prRegions = STATE_CULTURAL_REGIONS['PR'];
      expect(prRegions).toBeDefined();
      expect(prRegions.length).toBeGreaterThan(0);
    });

    it('VI: should have cultural regions', () => {
      const viRegions = STATE_CULTURAL_REGIONS['VI'];
      expect(viRegions).toBeDefined();
      expect(viRegions.length).toBeGreaterThan(0);
    });

    it('GU: should have cultural regions', () => {
      const guRegions = STATE_CULTURAL_REGIONS['GU'];
      expect(guRegions).toBeDefined();
      expect(guRegions.length).toBeGreaterThan(0);
    });
  });
});
