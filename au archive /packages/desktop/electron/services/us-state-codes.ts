/**
 * US State Codes - Mapping and validation data
 * Separated per LILBITS rule (max 300 lines per script)
 */

// US State name to abbreviation mapping
export const STATE_ABBREVIATIONS: Record<string, string> = {
  'alabama': 'AL',
  'alaska': 'AK',
  'arizona': 'AZ',
  'arkansas': 'AR',
  'california': 'CA',
  'colorado': 'CO',
  'connecticut': 'CT',
  'delaware': 'DE',
  'florida': 'FL',
  'georgia': 'GA',
  'hawaii': 'HI',
  'idaho': 'ID',
  'illinois': 'IL',
  'indiana': 'IN',
  'iowa': 'IA',
  'kansas': 'KS',
  'kentucky': 'KY',
  'louisiana': 'LA',
  'maine': 'ME',
  'maryland': 'MD',
  'massachusetts': 'MA',
  'michigan': 'MI',
  'minnesota': 'MN',
  'mississippi': 'MS',
  'missouri': 'MO',
  'montana': 'MT',
  'nebraska': 'NE',
  'nevada': 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  'ohio': 'OH',
  'oklahoma': 'OK',
  'oregon': 'OR',
  'pennsylvania': 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  'tennessee': 'TN',
  'texas': 'TX',
  'utah': 'UT',
  'vermont': 'VT',
  'virginia': 'VA',
  'washington': 'WA',
  'west virginia': 'WV',
  'wisconsin': 'WI',
  'wyoming': 'WY',
  'district of columbia': 'DC',
  'puerto rico': 'PR',
  'guam': 'GU',
  'virgin islands': 'VI',
  'american samoa': 'AS',
  'northern mariana islands': 'MP',
};

// Valid 2-letter state codes (derived from abbreviations)
export const VALID_STATE_CODES = new Set(Object.values(STATE_ABBREVIATIONS));

/**
 * Check if a string is a valid US state code
 */
export function isValidStateCode(code: string): boolean {
  return VALID_STATE_CODES.has(code.toUpperCase());
}

/**
 * Get state code from full name (returns null if not found)
 */
export function getStateCodeFromName(name: string): string | null {
  const lower = name.toLowerCase().trim();
  return STATE_ABBREVIATIONS[lower] || null;
}
