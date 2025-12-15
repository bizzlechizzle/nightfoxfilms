/**
 * Libpostal Service - Address parsing and normalization
 *
 * Uses libpostal (via node-postal) when available for ML-powered address parsing.
 * Falls back to regex-based parsing when libpostal C library is not installed.
 *
 * To enable libpostal:
 * 1. Install libpostal C library: https://github.com/openvenues/libpostal
 *    - macOS: brew install libpostal
 *    - Ubuntu: Build from source (see docs)
 * 2. Rebuild node-postal: pnpm rebuild node-postal
 */

export interface ParsedAddressComponent {
  label: string;
  value: string;
}

export interface LibpostalResult {
  house_number: string | null;
  house: string | null;
  road: string | null;
  unit: string | null;
  city: string | null;
  city_district: string | null;
  county: string | null;
  state: string | null;
  state_district: string | null;
  postcode: string | null;
  country: string | null;
  // Metadata
  _source: 'libpostal' | 'regex_fallback';
  _confidence: 'high' | 'medium' | 'low';
}

// Cache libpostal availability check
let libpostalAvailable: boolean | null = null;
let postalParser: any = null;
let postalExpander: any = null;

/**
 * Check if libpostal is available on this system
 */
export function isLibpostalAvailable(): boolean {
  if (libpostalAvailable !== null) {
    return libpostalAvailable;
  }

  try {
    // Dynamic require to avoid crash if not available
    const postal = require('node-postal');
    postalParser = postal.parser;
    postalExpander = postal.expand;
    libpostalAvailable = true;
    console.log('[Libpostal] Successfully loaded node-postal');
  } catch (err) {
    libpostalAvailable = false;
    console.log('[Libpostal] Not available, using regex fallback:', (err as Error).message?.split('\n')[0]);
  }

  return libpostalAvailable;
}

/**
 * Parse an address using libpostal (or fallback)
 */
export function parseAddress(address: string): LibpostalResult {
  if (!address || typeof address !== 'string') {
    return emptyResult('regex_fallback', 'low');
  }

  const trimmed = address.trim();
  if (!trimmed) {
    return emptyResult('regex_fallback', 'low');
  }

  // Try libpostal first
  if (isLibpostalAvailable() && postalParser) {
    try {
      const components = postalParser.parse_address(trimmed) as ParsedAddressComponent[];
      return componentsToResult(components, 'libpostal');
    } catch (err) {
      console.error('[Libpostal] Parse error, falling back to regex:', err);
    }
  }

  // Fallback to regex parsing
  return regexParseAddress(trimmed);
}

/**
 * Expand address variations using libpostal
 * Returns array of possible normalized forms
 */
export function expandAddress(address: string): string[] {
  if (!address || typeof address !== 'string') {
    return [];
  }

  const trimmed = address.trim();
  if (!trimmed) {
    return [];
  }

  // Try libpostal expander
  if (isLibpostalAvailable() && postalExpander) {
    try {
      return postalExpander.expand_address(trimmed) as string[];
    } catch (err) {
      console.error('[Libpostal] Expand error:', err);
    }
  }

  // Fallback: return basic variations
  return regexExpandAddress(trimmed);
}

/**
 * Convert libpostal components to our result format
 */
function componentsToResult(
  components: ParsedAddressComponent[],
  source: 'libpostal' | 'regex_fallback'
): LibpostalResult {
  const result = emptyResult(source, source === 'libpostal' ? 'high' : 'medium');

  for (const { label, value } of components) {
    switch (label) {
      case 'house_number':
        result.house_number = value;
        break;
      case 'house':
        result.house = value;
        break;
      case 'road':
        result.road = value;
        break;
      case 'unit':
        result.unit = value;
        break;
      case 'city':
        result.city = value;
        break;
      case 'city_district':
        result.city_district = value;
        break;
      case 'county':
        result.county = value;
        break;
      case 'state':
        result.state = value;
        break;
      case 'state_district':
        result.state_district = value;
        break;
      case 'postcode':
        result.postcode = value;
        break;
      case 'country':
        result.country = value;
        break;
    }
  }

  return result;
}

/**
 * Empty result template
 */
function emptyResult(
  source: 'libpostal' | 'regex_fallback',
  confidence: 'high' | 'medium' | 'low'
): LibpostalResult {
  return {
    house_number: null,
    house: null,
    road: null,
    unit: null,
    city: null,
    city_district: null,
    county: null,
    state: null,
    state_district: null,
    postcode: null,
    country: null,
    _source: source,
    _confidence: confidence,
  };
}

// ============================================================================
// REGEX FALLBACK IMPLEMENTATION
// ============================================================================

// US State mappings
const STATE_NAMES_TO_CODES: Record<string, string> = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
  'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
  'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
  'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
  'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
  'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
  'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
  'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
  'wisconsin': 'WI', 'wyoming': 'WY', 'district of columbia': 'DC',
};

const VALID_STATE_CODES = new Set(Object.values(STATE_NAMES_TO_CODES));

// Street type abbreviations
const STREET_TYPES: Record<string, string> = {
  'st': 'street', 'st.': 'street',
  'ave': 'avenue', 'ave.': 'avenue',
  'blvd': 'boulevard', 'blvd.': 'boulevard',
  'dr': 'drive', 'dr.': 'drive',
  'rd': 'road', 'rd.': 'road',
  'ln': 'lane', 'ln.': 'lane',
  'ct': 'court', 'ct.': 'court',
  'pl': 'place', 'pl.': 'place',
  'cir': 'circle', 'cir.': 'circle',
  'hwy': 'highway', 'hwy.': 'highway',
  'pkwy': 'parkway', 'pkwy.': 'parkway',
  'ter': 'terrace', 'ter.': 'terrace',
  'trl': 'trail', 'trl.': 'trail',
  'way': 'way',
};

// Direction abbreviations
const DIRECTIONS: Record<string, string> = {
  'n': 'north', 'n.': 'north',
  's': 'south', 's.': 'south',
  'e': 'east', 'e.': 'east',
  'w': 'west', 'w.': 'west',
  'ne': 'northeast', 'nw': 'northwest',
  'se': 'southeast', 'sw': 'southwest',
};

/**
 * Regex-based address parser (fallback when libpostal unavailable)
 */
function regexParseAddress(address: string): LibpostalResult {
  const result = emptyResult('regex_fallback', 'medium');

  // Normalize input
  const cleaned = address.replace(/\s+/g, ' ').trim();
  const parts = cleaned.split(',').map(p => p.trim()).filter(p => p);

  if (parts.length === 0) {
    result._confidence = 'low';
    return result;
  }

  // Work from right to left (most reliable)
  let remaining = [...parts];

  // Last part: usually "STATE ZIPCODE" or just state/zip
  if (remaining.length > 0) {
    const lastPart = remaining[remaining.length - 1];
    const stateZip = parseStateAndZip(lastPart);

    if (stateZip.state || stateZip.postcode) {
      result.state = stateZip.state;
      result.postcode = stateZip.postcode;
      remaining.pop();
    }
  }

  // Next from right: City
  if (remaining.length > 0) {
    const potentialCity = remaining[remaining.length - 1];
    // City shouldn't start with a number (that would be street address)
    if (!/^\d/.test(potentialCity)) {
      result.city = normalizeCity(potentialCity);
      remaining.pop();
    }
  }

  // Remaining: Street address
  if (remaining.length > 0) {
    const streetPart = remaining.join(', ');
    const parsed = parseStreetAddress(streetPart);
    result.house_number = parsed.house_number;
    result.road = parsed.road;
    result.unit = parsed.unit;
  }

  // Calculate confidence
  const fieldCount = [
    result.house_number, result.road, result.city,
    result.state, result.postcode
  ].filter(f => f !== null).length;

  if (fieldCount >= 4) {
    result._confidence = 'high';
  } else if (fieldCount >= 2) {
    result._confidence = 'medium';
  } else {
    result._confidence = 'low';
  }

  result.country = 'us'; // Assume US for now

  return result;
}

/**
 * Parse state and zipcode from a string like "NY 12345" or "New York 12345-6789"
 */
function parseStateAndZip(input: string): { state: string | null; postcode: string | null } {
  const result = { state: null as string | null, postcode: null as string | null };

  // Try: "STATE ZIPCODE" pattern
  const stateZipMatch = input.match(/^([A-Za-z]+(?:\s+[A-Za-z]+)?)\s+(\d{5}(?:-\d{4})?)$/);
  if (stateZipMatch) {
    result.state = normalizeState(stateZipMatch[1]);
    result.postcode = normalizeZip(stateZipMatch[2]);
    return result;
  }

  // Try just zipcode
  const zipMatch = input.match(/^(\d{5}(?:-\d{4})?)$/);
  if (zipMatch) {
    result.postcode = normalizeZip(zipMatch[1]);
    return result;
  }

  // Try just state
  result.state = normalizeState(input);

  return result;
}

/**
 * Normalize state to 2-letter code
 */
function normalizeState(input: string): string | null {
  if (!input) return null;

  const trimmed = input.trim();
  const upper = trimmed.toUpperCase();

  // Already a valid 2-letter code
  if (upper.length === 2 && VALID_STATE_CODES.has(upper)) {
    return upper.toLowerCase(); // libpostal uses lowercase
  }

  // Try full name
  const lower = trimmed.toLowerCase();
  const code = STATE_NAMES_TO_CODES[lower];
  if (code) {
    return code.toLowerCase();
  }

  return null;
}

/**
 * Normalize zipcode
 */
function normalizeZip(input: string): string | null {
  if (!input) return null;

  const digits = input.replace(/[^\d]/g, '');

  if (digits.length === 5) {
    return digits;
  }
  if (digits.length === 9) {
    return `${digits.slice(0, 5)}-${digits.slice(5)}`;
  }
  if (digits.length >= 5) {
    return digits.slice(0, 5);
  }

  return null;
}

/**
 * Normalize city name
 */
function normalizeCity(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * Parse street address to extract house number, road, unit
 */
function parseStreetAddress(input: string): {
  house_number: string | null;
  road: string | null;
  unit: string | null;
} {
  const result = { house_number: null as string | null, road: null as string | null, unit: null as string | null };

  if (!input) return result;

  let remaining = input.trim();

  // Extract unit (Apt, Suite, Unit, #)
  const unitMatch = remaining.match(/(?:,?\s*)(apt\.?|suite|ste\.?|unit|#)\s*([A-Za-z0-9-]+)\s*$/i);
  if (unitMatch) {
    result.unit = unitMatch[2].toLowerCase();
    remaining = remaining.slice(0, unitMatch.index).trim();
  }

  // Extract house number at start
  const houseMatch = remaining.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
  if (houseMatch) {
    result.house_number = houseMatch[1];
    remaining = houseMatch[2];
  }

  // Remaining is the road
  result.road = normalizeRoad(remaining);

  return result;
}

/**
 * Normalize road name - expand abbreviations
 */
function normalizeRoad(input: string): string | null {
  if (!input) return null;

  let normalized = input.toLowerCase();

  // Expand street types
  for (const [abbr, full] of Object.entries(STREET_TYPES)) {
    const regex = new RegExp(`\\b${abbr.replace('.', '\\.')}$`, 'i');
    normalized = normalized.replace(regex, full);
  }

  // Expand directions
  for (const [abbr, full] of Object.entries(DIRECTIONS)) {
    const regex = new RegExp(`\\b${abbr.replace('.', '\\.')}\\b`, 'gi');
    normalized = normalized.replace(regex, full);
  }

  return normalized.replace(/\s+/g, ' ').trim() || null;
}

/**
 * Regex-based address expansion (fallback)
 */
function regexExpandAddress(address: string): string[] {
  const variations: string[] = [address];
  let normalized = address.toLowerCase();

  // Expand abbreviations
  for (const [abbr, full] of Object.entries(STREET_TYPES)) {
    if (normalized.includes(abbr)) {
      variations.push(normalized.replace(new RegExp(`\\b${abbr.replace('.', '\\.')}\\b`, 'gi'), full));
    }
  }

  for (const [abbr, full] of Object.entries(DIRECTIONS)) {
    if (normalized.includes(abbr)) {
      variations.push(normalized.replace(new RegExp(`\\b${abbr.replace('.', '\\.')}\\b`, 'gi'), full));
    }
  }

  // Remove duplicates
  return [...new Set(variations)];
}

/**
 * Get libpostal status for diagnostics
 */
export function getLibpostalStatus(): {
  available: boolean;
  source: string;
  message: string;
} {
  const available = isLibpostalAvailable();

  if (available) {
    return {
      available: true,
      source: 'libpostal',
      message: 'Using libpostal ML-powered address parsing',
    };
  }

  return {
    available: false,
    source: 'regex_fallback',
    message: 'Libpostal not installed. Using regex fallback. Install libpostal for better accuracy.',
  };
}
