/**
 * Address Normalizer Service
 * Ensures consistent address formatting across all entry points
 * Per claude.md spec: address_state must be 2 characters, zipcode must match 5 or 5+4 format
 *
 * Kanye11: Now uses libpostal when available for ML-powered address parsing
 */

import { STATE_ABBREVIATIONS, VALID_STATE_CODES } from './us-state-codes';
import {
  parseAddress as libpostalParse,
  expandAddress as libpostalExpand,
  isLibpostalAvailable,
  getLibpostalStatus,
  type LibpostalResult,
} from './libpostal-service';

export interface RawAddress {
  street?: string | null;
  houseNumber?: string | null;
  city?: string | null;
  county?: string | null;
  state?: string | null;
  stateCode?: string | null;
  zipcode?: string | null;
  country?: string | null;
  countryCode?: string | null;
}

export interface NormalizedAddress {
  street: string | null;
  city: string | null;
  county: string | null;
  state: string | null; // Always 2-letter state code (e.g., "NY")
  zipcode: string | null; // Always 5 or 5+4 format
  confidence: 'high' | 'medium' | 'low';
  geocodedAt: string | null;
}

export class AddressNormalizer {
  /**
   * Normalize a state input to a 2-letter code
   * Handles: "New York" -> "NY", "ny" -> "NY", "NY" -> "NY"
   */
  static normalizeStateCode(state: string | null | undefined): string | null {
    if (!state || typeof state !== 'string') {
      return null;
    }

    const trimmed = state.trim();
    if (!trimmed) {
      return null;
    }

    // If already a valid 2-letter code
    const upper = trimmed.toUpperCase();
    if (upper.length === 2 && VALID_STATE_CODES.has(upper)) {
      return upper;
    }

    // Try to map from full state name
    const lower = trimmed.toLowerCase();
    const abbr = STATE_ABBREVIATIONS[lower];
    if (abbr) {
      return abbr;
    }

    // Return null if we can't normalize it
    console.warn(`AddressNormalizer: Could not normalize state "${state}"`);
    return null;
  }

  /**
   * Normalize a zipcode to 5 or 5+4 format
   * Handles: "12345-6789" -> "12345-6789", "12345 6789" -> "12345-6789", "123456789" -> "12345-6789"
   */
  static normalizeZipcode(zipcode: string | null | undefined): string | null {
    if (!zipcode || typeof zipcode !== 'string') {
      return null;
    }

    // Remove all non-numeric characters except hyphen
    const cleaned = zipcode.replace(/[^\d-]/g, '');

    // Extract just digits
    const digits = cleaned.replace(/-/g, '');

    // Validate we have either 5 or 9 digits
    if (digits.length === 5) {
      return digits;
    }

    if (digits.length === 9) {
      return `${digits.slice(0, 5)}-${digits.slice(5)}`;
    }

    // If it's close to 5 digits, try to extract
    if (digits.length >= 5) {
      const fiveDigit = digits.slice(0, 5);
      if (/^\d{5}$/.test(fiveDigit)) {
        return fiveDigit;
      }
    }

    console.warn(`AddressNormalizer: Could not normalize zipcode "${zipcode}"`);
    return null;
  }

  /**
   * Normalize a street address
   * Handles: whitespace trimming, case normalization
   */
  static normalizeStreet(street: string | null | undefined): string | null {
    if (!street || typeof street !== 'string') {
      return null;
    }

    // Trim and collapse multiple spaces
    const normalized = street.trim().replace(/\s+/g, ' ');

    if (!normalized) {
      return null;
    }

    return normalized;
  }

  /**
   * Normalize a city name
   * Handles: whitespace trimming, title case
   */
  static normalizeCity(city: string | null | undefined): string | null {
    if (!city || typeof city !== 'string') {
      return null;
    }

    const trimmed = city.trim();
    if (!trimmed) {
      return null;
    }

    // Title case the city name
    return trimmed
      .toLowerCase()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  /**
   * Normalize a county name
   * Handles: whitespace trimming, removes " County" suffix if present
   */
  static normalizeCounty(county: string | null | undefined): string | null {
    if (!county || typeof county !== 'string') {
      return null;
    }

    let trimmed = county.trim();
    if (!trimmed) {
      return null;
    }

    // Remove " County" suffix if present (common in Nominatim responses)
    if (trimmed.toLowerCase().endsWith(' county')) {
      trimmed = trimmed.slice(0, -7);
    }

    // Title case
    return trimmed
      .toLowerCase()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  /**
   * Normalize a complete address from various sources
   * Primary method for normalizing geocoding results
   */
  static normalizeAddress(
    raw: RawAddress,
    confidence: 'high' | 'medium' | 'low' = 'medium'
  ): NormalizedAddress {
    // For state, prefer stateCode if available, otherwise try to extract from state
    let normalizedState: string | null = null;
    if (raw.stateCode) {
      normalizedState = this.normalizeStateCode(raw.stateCode);
    }
    if (!normalizedState && raw.state) {
      normalizedState = this.normalizeStateCode(raw.state);
    }

    // Build street address from components if needed
    let street = raw.street;
    if (raw.houseNumber && street) {
      // Nominatim sometimes separates house number
      street = `${raw.houseNumber} ${street}`;
    }

    return {
      street: this.normalizeStreet(street),
      city: this.normalizeCity(raw.city),
      county: this.normalizeCounty(raw.county),
      state: normalizedState,
      zipcode: this.normalizeZipcode(raw.zipcode),
      confidence,
      geocodedAt: new Date().toISOString(),
    };
  }

  /**
   * Validate if an address has minimum required fields
   * Returns true if address has at least state OR (city AND zipcode)
   */
  static isValidAddress(address: NormalizedAddress): boolean {
    // Must have state
    if (address.state) {
      return true;
    }
    // Or city and zipcode
    if (address.city && address.zipcode) {
      return true;
    }
    return false;
  }

  /**
   * Get a formatted display string for an address
   */
  static formatAddress(address: NormalizedAddress): string {
    const parts: string[] = [];

    if (address.street) {
      parts.push(address.street);
    }
    if (address.city) {
      parts.push(address.city);
    }
    if (address.state && address.zipcode) {
      parts.push(`${address.state} ${address.zipcode}`);
    } else if (address.state) {
      parts.push(address.state);
    } else if (address.zipcode) {
      parts.push(address.zipcode);
    }

    return parts.join(', ');
  }

  /**
   * Parse an address string into components (best effort)
   * This is for user-entered addresses, not geocoding results
   */
  static parseAddressString(addressString: string): Partial<NormalizedAddress> {
    if (!addressString || typeof addressString !== 'string') {
      return {};
    }

    const parts = addressString.split(',').map((p) => p.trim());
    const result: Partial<NormalizedAddress> = {};

    // Try to identify components from right to left (most reliable order)
    if (parts.length >= 1) {
      const lastPart = parts[parts.length - 1];

      // Check if last part is "STATE ZIPCODE" or just "STATE" or just "ZIPCODE"
      const stateZipMatch = lastPart.match(/^([A-Za-z]{2})\s*(\d{5}(?:-\d{4})?)$/);
      if (stateZipMatch) {
        result.state = this.normalizeStateCode(stateZipMatch[1]);
        result.zipcode = this.normalizeZipcode(stateZipMatch[2]);
        parts.pop();
      } else {
        const stateOnly = this.normalizeStateCode(lastPart);
        if (stateOnly) {
          result.state = stateOnly;
          parts.pop();
        } else {
          const zipOnly = this.normalizeZipcode(lastPart);
          if (zipOnly) {
            result.zipcode = zipOnly;
            parts.pop();
          }
        }
      }
    }

    // Next part (from right) should be city
    if (parts.length >= 1) {
      result.city = this.normalizeCity(parts.pop());
    }

    // Remaining parts are street address
    if (parts.length >= 1) {
      result.street = this.normalizeStreet(parts.join(', '));
    }

    return result;
  }

  /**
   * FIX 6.4: Enhanced address parsing (libpostal alternative)
   * Parses full addresses like "123 Main St, Springfield, IL 62701"
   * Extracts: house_number, street, city, state, zipcode
   * Normalizes: "St" → "Street", abbreviations expanded
   */
  static parseFullAddress(input: string): ParsedAddress {
    const result: ParsedAddress = {
      house_number: null,
      street: null,
      city: null,
      state: null,
      zipcode: null,
      country: 'US',
      confidence: 'low',
    };

    if (!input || typeof input !== 'string') {
      return result;
    }

    const cleaned = input.trim();
    if (!cleaned) {
      return result;
    }

    // Split by comma for major components
    const parts = cleaned.split(',').map(p => p.trim()).filter(p => p);

    // Work from right to left (most reliable order)
    let remaining = [...parts];

    // Last part: STATE ZIPCODE (e.g., "IL 62701" or "Illinois 62701")
    if (remaining.length > 0) {
      const lastPart = remaining[remaining.length - 1];

      // Try: "STATE ZIPCODE" pattern
      const stateZipMatch = lastPart.match(/^([A-Za-z]+(?:\s+[A-Za-z]+)?)\s+(\d{5}(?:-\d{4})?)$/);
      if (stateZipMatch) {
        result.state = this.normalizeStateCode(stateZipMatch[1]);
        result.zipcode = this.normalizeZipcode(stateZipMatch[2]);
        remaining.pop();
      } else {
        // Try just state or just zipcode
        const stateOnly = this.normalizeStateCode(lastPart);
        const zipOnly = this.normalizeZipcode(lastPart);

        if (stateOnly && !zipOnly) {
          result.state = stateOnly;
          remaining.pop();
        } else if (zipOnly && !stateOnly) {
          result.zipcode = zipOnly;
          remaining.pop();
        } else if (stateOnly && zipOnly) {
          // Ambiguous - prefer state
          result.state = stateOnly;
          remaining.pop();
        }
      }
    }

    // Next from right: City
    if (remaining.length > 0) {
      const cityPart = remaining[remaining.length - 1];
      // Check it's not a street address (doesn't start with number)
      if (!/^\d/.test(cityPart)) {
        result.city = this.normalizeCity(cityPart);
        remaining.pop();
      }
    }

    // Remaining: Street address with potential house number
    if (remaining.length > 0) {
      const streetPart = remaining.join(', ');
      const parsed = this.parseStreetAddress(streetPart);
      result.house_number = parsed.house_number;
      result.street = parsed.street;
    }

    // Calculate confidence based on completeness
    const fieldCount = [result.house_number, result.street, result.city, result.state, result.zipcode]
      .filter(f => f !== null).length;

    if (fieldCount >= 4) {
      result.confidence = 'high';
    } else if (fieldCount >= 2) {
      result.confidence = 'medium';
    } else {
      result.confidence = 'low';
    }

    return result;
  }

  /**
   * Parse street address to extract house number and street name
   */
  private static parseStreetAddress(street: string): { house_number: string | null; street: string | null } {
    if (!street) {
      return { house_number: null, street: null };
    }

    const trimmed = street.trim();

    // Match house number at start: "123 Main St" or "123A Main St"
    const houseMatch = trimmed.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
    if (houseMatch) {
      return {
        house_number: houseMatch[1],
        street: this.normalizeStreetName(houseMatch[2]),
      };
    }

    return {
      house_number: null,
      street: this.normalizeStreetName(trimmed),
    };
  }

  /**
   * Normalize street name: expand abbreviations, proper case
   */
  private static normalizeStreetName(street: string): string | null {
    if (!street) return null;

    let normalized = street.trim();

    // Expand common abbreviations
    const abbreviations: Record<string, string> = {
      'St': 'Street',
      'St.': 'Street',
      'Ave': 'Avenue',
      'Ave.': 'Avenue',
      'Blvd': 'Boulevard',
      'Blvd.': 'Boulevard',
      'Dr': 'Drive',
      'Dr.': 'Drive',
      'Rd': 'Road',
      'Rd.': 'Road',
      'Ln': 'Lane',
      'Ln.': 'Lane',
      'Ct': 'Court',
      'Ct.': 'Court',
      'Pl': 'Place',
      'Pl.': 'Place',
      'Cir': 'Circle',
      'Cir.': 'Circle',
      'Hwy': 'Highway',
      'Hwy.': 'Highway',
      'Pkwy': 'Parkway',
      'Pkwy.': 'Parkway',
      'N': 'North',
      'N.': 'North',
      'S': 'South',
      'S.': 'South',
      'E': 'East',
      'E.': 'East',
      'W': 'West',
      'W.': 'West',
      'NE': 'Northeast',
      'NW': 'Northwest',
      'SE': 'Southeast',
      'SW': 'Southwest',
    };

    // Replace abbreviations at word boundaries
    for (const [abbr, full] of Object.entries(abbreviations)) {
      const regex = new RegExp(`\\b${abbr.replace('.', '\\.')}\\b`, 'gi');
      normalized = normalized.replace(regex, full);
    }

    // Collapse multiple spaces and trim
    normalized = normalized.replace(/\s+/g, ' ').trim();

    return normalized || null;
  }
}

/**
 * FIX 6.4: Parsed address result from parseFullAddress
 */
export interface ParsedAddress {
  house_number: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zipcode: string | null;
  country: string;
  confidence: 'high' | 'medium' | 'low';
}

// ============================================================================
// KANYE11: LIBPOSTAL-POWERED ADDRESS PARSING
// ============================================================================

/**
 * Kanye11: Parse address using libpostal (with fallback to regex)
 * This is the PRIMARY method for parsing user-entered addresses
 *
 * @param addressString - Full address string like "123 Main St, Springfield, IL 62701"
 * @returns ParsedAddress with extracted components and confidence level
 */
export function parseAddressWithLibpostal(addressString: string): ParsedAddress {
  const result = libpostalParse(addressString);

  // Convert libpostal result to our ParsedAddress format
  // libpostal uses lowercase, we need to normalize to our format
  let street: string | null = null;
  if (result.house_number && result.road) {
    street = `${result.house_number} ${titleCase(result.road)}`;
  } else if (result.road) {
    street = titleCase(result.road);
  } else if (result.house_number) {
    street = result.house_number;
  }

  // Add unit if present
  if (result.unit && street) {
    street = `${street}, Unit ${result.unit.toUpperCase()}`;
  }

  return {
    house_number: result.house_number,
    street,
    city: result.city ? titleCase(result.city) : null,
    state: result.state ? result.state.toUpperCase() : null,
    zipcode: result.postcode,
    country: result.country?.toUpperCase() || 'US',
    confidence: result._confidence,
  };
}

/**
 * Kanye11: Expand address to normalized variations
 * Useful for geocoding - try multiple forms
 */
export function expandAddressVariations(addressString: string): string[] {
  return libpostalExpand(addressString);
}

/**
 * Kanye11: Check if libpostal is available
 */
export function checkLibpostalStatus(): {
  available: boolean;
  source: string;
  message: string;
} {
  return getLibpostalStatus();
}

/**
 * Title case helper
 */
function titleCase(str: string): string {
  return str
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Re-export for convenience
export { isLibpostalAvailable };
