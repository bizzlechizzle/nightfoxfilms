/**
 * RegionService - Auto-populate Census regions, divisions, and state direction
 *
 * Per DECISION-012: Auto-Population of Regions
 * Per DECISION-017: Local & Region sections overhaul
 *
 * Features:
 * - Census Region lookup from state (4 regions: Northeast, Midwest, South, West)
 * - Census Division lookup from state (9 divisions)
 * - State Direction calculation from GPS vs state center
 * - Local Cultural Region suggestion from county lookup
 * - Country Cultural Region lookup from GPS (point-in-polygon)
 *
 * All calculations are offline-first using embedded data.
 */

import {
  getCensusRegion,
  getCensusDivision,
  getStateDirection,
  getStateFromGPS,
  getCulturalRegionFromCounty,
  getCulturalRegionsForState,
  getDefaultCountryRegion,
  STATE_CULTURAL_REGIONS,
  STATE_ADJACENCY,
} from '../../src/lib/census-regions';

import { CULTURAL_REGION_CENTERS } from '../../src/lib/cultural-region-centers';

import {
  getCountryCulturalRegion,
  getNearbyCountryCulturalRegions,
  getCountryCulturalRegionsByCategory,
  isValidCountryCulturalRegion,
  type CountryCulturalRegionWithDistance,
} from '../../src/lib/country-cultural-regions';

/**
 * Region fields for a location (nullable - original behavior)
 */
export interface RegionFields {
  censusRegion: string | null;           // Northeast, Midwest, South, West
  censusDivision: string | null;         // New England, Middle Atlantic, etc.
  stateDirection: string | null;         // e.g., "Eastern NY", "Central TX"
  culturalRegion: string | null;         // e.g., "Capital Region", "Hudson Valley" (local/state-level)
  countryCulturalRegion: string | null;  // e.g., "NYC Metro", "Cascadia" (national-level)
}

/**
 * Complete region fields for display - all 8 fields guaranteed non-null
 * Per region gap fix plan: Always show 4 Local + 4 Region fields
 */
export interface CompleteRegionFields {
  // Local Section (4 fields)
  county: string;                        // From address or "—" placeholder
  culturalRegion: string;                // From county lookup or state default
  stateDirection: string;                // From GPS or "Central {State}"
  stateName: string;                     // Full state name or "—" placeholder
  // Region Section (4 fields)
  countryCulturalRegion: string;         // From GPS polygon or state default
  censusRegion: string;                  // From state lookup or "—"
  country: string;                       // "United States" default
  continent: string;                     // "North America" default
  // Metadata
  hasGaps: boolean;                      // True if any field used fallback
  gapFields: string[];                   // List of fields that used fallbacks
}

/**
 * Input data for calculating region fields
 */
export interface RegionInput {
  state?: string | null;
  addressState?: string | null;                  // Fallback if state is empty
  county?: string | null;
  lat?: number | null;
  lng?: number | null;
  existingCulturalRegion?: string | null;        // Don't overwrite if already set
  existingCountryCulturalRegion?: string | null; // Don't overwrite if already set
}

/**
 * Calculate all region fields from location data
 * Returns region fields that should be auto-populated
 */
export function calculateRegionFields(input: RegionInput): RegionFields {
  const { state, addressState, county, lat, lng, existingCulturalRegion, existingCountryCulturalRegion } = input;

  // Use state or fall back to addressState, then try GPS→State as last resort
  let effectiveState = state || addressState || null;

  // GPS→State fallback: If no state from address, try to derive from GPS coordinates
  // This catches cases where geocoding failed but we have valid GPS
  if (!effectiveState && lat && lng) {
    const derivedState = getStateFromGPS(lat, lng);
    if (derivedState) {
      console.log(`[RegionService] Derived state ${derivedState} from GPS (${lat}, ${lng})`);
      effectiveState = derivedState;
    }
  }

  // Census Region from state (always recalculate)
  const censusRegion = getCensusRegion(effectiveState);

  // Census Division from state (always recalculate)
  const censusDivision = getCensusDivision(effectiveState);

  // State Direction from GPS + state (always recalculate)
  const stateDirection = getStateDirection(lat, lng, effectiveState);

  // Local Cultural Region from county lookup (only suggest if not already set)
  let culturalRegion = existingCulturalRegion || null;
  if (!culturalRegion && county && effectiveState) {
    culturalRegion = getCulturalRegionFromCounty(effectiveState, county);
  }

  // Country Cultural Region from GPS (only suggest if not already set)
  let countryCulturalRegion = existingCountryCulturalRegion || null;
  if (!countryCulturalRegion && lat && lng) {
    countryCulturalRegion = getCountryCulturalRegion(lat, lng);
  }

  return {
    censusRegion,
    censusDivision,
    stateDirection,
    culturalRegion,
    countryCulturalRegion,
  };
}

/**
 * STATE_NAMES: Convert state abbreviations to full names
 */
const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia', PR: 'Puerto Rico', VI: 'Virgin Islands', GU: 'Guam',
};

/**
 * Calculate complete region fields with all 8 fields guaranteed non-null
 * Uses fallback chain to ensure no gaps in Local or Region sections
 */
export function calculateCompleteRegionFields(input: RegionInput & {
  addressCounty?: string | null;
  country?: string | null;
  continent?: string | null;
}): CompleteRegionFields {
  const {
    state, addressState, county, lat, lng,
    existingCulturalRegion, existingCountryCulturalRegion,
    addressCounty, country: inputCountry, continent: inputContinent
  } = input;

  const gapFields: string[] = [];
  const effectiveState = state || addressState || null;
  const stateUpper = effectiveState?.toUpperCase() || null;

  // === LOCAL SECTION (4 fields) ===

  // 1. County: From address or placeholder
  let countyValue = addressCounty || county || null;
  if (!countyValue) {
    countyValue = '—';
    gapFields.push('county');
  }

  // 2. Cultural Region: From county lookup → state default → first region in state
  let culturalRegionValue = existingCulturalRegion || null;
  if (!culturalRegionValue && county && effectiveState) {
    culturalRegionValue = getCulturalRegionFromCounty(effectiveState, county);
  }
  if (!culturalRegionValue && stateUpper) {
    // Fallback to first cultural region for the state
    const stateRegions = STATE_CULTURAL_REGIONS[stateUpper];
    if (stateRegions && stateRegions.length > 0) {
      culturalRegionValue = stateRegions[0];
      gapFields.push('culturalRegion');
    }
  }
  if (!culturalRegionValue) {
    culturalRegionValue = '—';
    gapFields.push('culturalRegion');
  }

  // 3. State Direction: From GPS calculation → "Central {State}" → just state name
  let stateDirectionValue = getStateDirection(lat, lng, effectiveState);
  if (!stateDirectionValue && stateUpper) {
    stateDirectionValue = `Central ${stateUpper}`;
    gapFields.push('stateDirection');
  }
  if (!stateDirectionValue) {
    stateDirectionValue = '—';
    gapFields.push('stateDirection');
  }

  // 4. State Name: From state abbreviation lookup
  let stateNameValue = stateUpper ? STATE_NAMES[stateUpper] || stateUpper : null;
  if (!stateNameValue) {
    stateNameValue = '—';
    gapFields.push('stateName');
  }

  // === REGION SECTION (4 fields) ===

  // 5. Country Cultural Region: From GPS polygon → state default
  let countryCulturalRegionValue = existingCountryCulturalRegion || null;
  if (!countryCulturalRegionValue && lat && lng) {
    countryCulturalRegionValue = getCountryCulturalRegion(lat, lng);
  }
  if (!countryCulturalRegionValue && effectiveState) {
    countryCulturalRegionValue = getDefaultCountryRegion(effectiveState);
    if (countryCulturalRegionValue) {
      gapFields.push('countryCulturalRegion');
    }
  }
  if (!countryCulturalRegionValue) {
    countryCulturalRegionValue = '—';
    gapFields.push('countryCulturalRegion');
  }

  // 6. Census Region: From state lookup
  let censusRegionValue = getCensusRegion(effectiveState);
  if (!censusRegionValue) {
    censusRegionValue = '—';
    gapFields.push('censusRegion');
  }

  // 7. Country: From input or default
  const countryValue = inputCountry || 'United States';

  // 8. Continent: From input or default
  const continentValue = inputContinent || 'North America';

  return {
    county: countyValue,
    culturalRegion: culturalRegionValue,
    stateDirection: stateDirectionValue,
    stateName: stateNameValue,
    countryCulturalRegion: countryCulturalRegionValue,
    censusRegion: censusRegionValue,
    country: countryValue,
    continent: continentValue,
    hasGaps: gapFields.length > 0,
    gapFields,
  };
}

/**
 * Get cultural region options for a state (for dropdown)
 */
export function getCulturalRegionOptions(state: string | null | undefined): string[] {
  return getCulturalRegionsForState(state);
}

/**
 * Haversine distance calculation (in miles)
 */
function haversineDistanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}


/**
 * Get filtered cultural region options for dropdown
 * Shows: All regions from current state + up to 3 adjacent state regions within 25 miles
 * Per region gap fix plan: Adjacent regions limited by distance
 */
export interface FilteredCulturalRegion {
  region: string;
  state: string;
  isAdjacent: boolean;
  distance?: number; // Miles from GPS (only for adjacent regions)
}

export function getFilteredCulturalRegionOptions(
  state: string | null | undefined,
  lat: number | null | undefined,
  lng: number | null | undefined,
  maxDistanceMiles: number = 25,
  maxAdjacentRegions: number = 3
): FilteredCulturalRegion[] {
  if (!state) return [];

  const stateUpper = state.toUpperCase();
  const results: FilteredCulturalRegion[] = [];

  // 1. Add all regions from current state
  const currentStateRegions = STATE_CULTURAL_REGIONS[stateUpper] || [];
  for (const region of currentStateRegions) {
    results.push({
      region,
      state: stateUpper,
      isAdjacent: false,
    });
  }

  // 2. If GPS available, add adjacent state regions within distance limit
  if (lat && lng) {
    const adjacentStates = STATE_ADJACENCY[stateUpper] || [];
    const nearbyAdjacentRegions: FilteredCulturalRegion[] = [];

    for (const adjState of adjacentStates) {
      const adjRegions = STATE_CULTURAL_REGIONS[adjState] || [];
      for (const region of adjRegions) {
        const centerKey = `${adjState}:${region}`;
        const center = CULTURAL_REGION_CENTERS[centerKey];
        if (center) {
          const distance = haversineDistanceMiles(lat, lng, center.lat, center.lng);
          if (distance <= maxDistanceMiles) {
            nearbyAdjacentRegions.push({
              region: `${region} (${adjState})`,
              state: adjState,
              isAdjacent: true,
              distance: Math.round(distance),
            });
          }
        }
      }
    }

    // Sort by distance and take top N
    nearbyAdjacentRegions.sort((a, b) => (a.distance || 0) - (b.distance || 0));
    results.push(...nearbyAdjacentRegions.slice(0, maxAdjacentRegions));
  }

  return results;
}

/**
 * Get simple string array of filtered cultural regions for dropdown
 * (Convenience wrapper for simple dropdown use)
 */
export function getFilteredCulturalRegionStrings(
  state: string | null | undefined,
  lat: number | null | undefined,
  lng: number | null | undefined,
  maxDistanceMiles: number = 25,
  maxAdjacentRegions: number = 3
): string[] {
  const filtered = getFilteredCulturalRegionOptions(state, lat, lng, maxDistanceMiles, maxAdjacentRegions);
  return filtered.map(r => r.region);
}

/**
 * Validate that a cultural region is valid for the given state
 */
export function isValidCulturalRegion(
  state: string | null | undefined,
  culturalRegion: string | null | undefined
): boolean {
  if (!culturalRegion) return true; // null is always valid
  const options = getCulturalRegionsForState(state);
  return options.includes(culturalRegion);
}

// Re-export individual functions for direct use
export {
  getCensusRegion,
  getCensusDivision,
  getStateDirection,
  getCulturalRegionFromCounty,
  getCulturalRegionsForState,
  getDefaultCountryRegion,
  // DECISION-017: Country Cultural Region exports
  getCountryCulturalRegion,
  getNearbyCountryCulturalRegions,
  getCountryCulturalRegionsByCategory,
  isValidCountryCulturalRegion,
};

// Re-export types
export type { CountryCulturalRegionWithDistance };
