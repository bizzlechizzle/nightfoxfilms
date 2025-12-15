/**
 * Display Helpers - Graceful Degradation Utilities
 * Per Kanye6: ALWAYS return something, never null for display data
 *
 * Provides fallback chains for images, coordinates, and address formatting
 * to ensure Premium Archive shows something at every state.
 */

import type { Location } from '@au-archive/core';

// State capitals for approximate GPS fallback
export const STATE_CAPITALS: Record<string, { lat: number; lng: number }> = {
  AL: { lat: 32.377716, lng: -86.300568 },
  AK: { lat: 58.301598, lng: -134.420212 },
  AZ: { lat: 33.448143, lng: -112.096962 },
  AR: { lat: 34.746613, lng: -92.288986 },
  CA: { lat: 38.576668, lng: -121.493629 },
  CO: { lat: 39.739227, lng: -104.984856 },
  CT: { lat: 41.764046, lng: -72.682198 },
  DE: { lat: 39.157307, lng: -75.519722 },
  FL: { lat: 30.438118, lng: -84.281296 },
  GA: { lat: 33.749027, lng: -84.388229 },
  HI: { lat: 21.307442, lng: -157.857376 },
  ID: { lat: 43.617775, lng: -116.199722 },
  IL: { lat: 39.798363, lng: -89.654961 },
  IN: { lat: 39.768623, lng: -86.162643 },
  IA: { lat: 41.591087, lng: -93.603729 },
  KS: { lat: 39.048191, lng: -95.677956 },
  KY: { lat: 38.186722, lng: -84.875374 },
  LA: { lat: 30.457069, lng: -91.187393 },
  ME: { lat: 44.307167, lng: -69.781693 },
  MD: { lat: 38.978764, lng: -76.490936 },
  MA: { lat: 42.358162, lng: -71.063698 },
  MI: { lat: 42.733635, lng: -84.555328 },
  MN: { lat: 44.955097, lng: -93.102211 },
  MS: { lat: 32.303848, lng: -90.182106 },
  MO: { lat: 38.579201, lng: -92.172935 },
  MT: { lat: 46.585709, lng: -112.018417 },
  NE: { lat: 40.808075, lng: -96.699654 },
  NV: { lat: 39.163914, lng: -119.766121 },
  NH: { lat: 43.206898, lng: -71.537994 },
  NJ: { lat: 40.220596, lng: -74.769913 },
  NM: { lat: 35.682240, lng: -105.939728 },
  NY: { lat: 42.652843, lng: -73.757874 },
  NC: { lat: 35.787743, lng: -78.644257 },
  ND: { lat: 46.820850, lng: -100.783318 },
  OH: { lat: 39.961346, lng: -82.999069 },
  OK: { lat: 35.492207, lng: -97.503342 },
  OR: { lat: 44.938461, lng: -123.030403 },
  PA: { lat: 40.264378, lng: -76.883598 },
  RI: { lat: 41.830914, lng: -71.414963 },
  SC: { lat: 34.000343, lng: -81.033211 },
  SD: { lat: 44.367031, lng: -100.346405 },
  TN: { lat: 36.165810, lng: -86.784241 },
  TX: { lat: 30.27467, lng: -97.740349 },
  UT: { lat: 40.777477, lng: -111.888237 },
  VT: { lat: 44.262436, lng: -72.580536 },
  VA: { lat: 37.538857, lng: -77.433640 },
  WA: { lat: 47.035805, lng: -122.905014 },
  WV: { lat: 38.336246, lng: -81.612328 },
  WI: { lat: 43.074684, lng: -89.384445 },
  WY: { lat: 41.140259, lng: -104.820236 },
  DC: { lat: 38.89511, lng: -77.03637 },
};

// US geographic center for last-resort fallback
const US_CENTER = { lat: 39.8283, lng: -98.5795 };

export interface MediaImage {
  imghash: string;
  imgnam: string;
  imgloc: string;
  thumb_path?: string | null;
  thumb_path_sm?: string | null;
  thumb_path_lg?: string | null;
  preview_path?: string | null;
}

export interface Coordinates {
  lat: number;
  lng: number;
  confidence: 'exact' | 'approximate' | 'none';
  zoomLevel: number;
  source?: string;
}

/**
 * Get the best available image source for display
 * Priority: preview > thumb_lg > thumb_sm > thumb > placeholder
 */
export function getBestImageSource(image: MediaImage): string {
  return image.preview_path
    || image.thumb_path_lg
    || image.thumb_path_sm
    || image.thumb_path
    || '/placeholder-image.svg';
}

/**
 * Get best thumbnail source for grid display
 * Priority: thumb_sm > thumb_lg > thumb > placeholder
 */
export function getBestThumbnailSource(image: MediaImage): string {
  return image.thumb_path_sm
    || image.thumb_path_lg
    || image.thumb_path
    || '/placeholder-image.svg';
}

/**
 * Get best coordinates for map display with fallback chain
 * Priority: exact GPS > state capital > US center
 */
export function getBestCoordinates(location: Location): Coordinates {
  // Priority 1: Exact GPS
  if (location.gps?.lat && location.gps?.lng) {
    return {
      lat: location.gps.lat,
      lng: location.gps.lng,
      confidence: 'exact',
      zoomLevel: 17,
      source: location.gps.source || 'unknown',
    };
  }

  // Priority 2: State capital
  if (location.address?.state) {
    const stateCode = location.address.state.toUpperCase();
    const capital = STATE_CAPITALS[stateCode];
    if (capital) {
      return {
        lat: capital.lat,
        lng: capital.lng,
        confidence: 'approximate',
        zoomLevel: 10,
        source: 'state_capital',
      };
    }
  }

  // Priority 3: US center (last resort)
  return {
    lat: US_CENTER.lat,
    lng: US_CENTER.lng,
    confidence: 'none',
    zoomLevel: 4,
    source: 'us_center',
  };
}

/**
 * Normalize city name for display
 * Removes "Village of", "City of", "Town of" prefixes
 */
export function getDisplayCity(city: string | null | undefined): string {
  if (!city) return '';
  return city.replace(/^(Village of|City of|Town of)\s*/i, '').trim();
}

/**
 * Format full address for display
 */
export function formatAddress(address: Location['address']): string {
  if (!address) return '';

  const parts = [
    address.street,
    getDisplayCity(address.city),
    address.state,
    address.zipcode,
  ].filter(Boolean);

  return parts.join(', ');
}

/**
 * Check if image has any displayable thumbnail
 */
export function hasDisplayableThumbnail(image: MediaImage): boolean {
  return !!(
    image.thumb_path_sm ||
    image.thumb_path_lg ||
    image.thumb_path ||
    image.preview_path
  );
}

/**
 * Get zoom level based on coordinate confidence
 */
export function getZoomForConfidence(
  confidence: 'exact' | 'approximate' | 'none'
): number {
  switch (confidence) {
    case 'exact':
      return 17; // Street level
    case 'approximate':
      return 10; // City level
    case 'none':
    default:
      return 4; // Country level
  }
}
