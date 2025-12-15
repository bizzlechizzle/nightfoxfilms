/**
 * Address Extraction Agent
 *
 * Extracts addresses from web sources to validate/suggest corrections
 * to the main location address. Uses spaCy GPE/LOC entities as preprocessing
 * input for smarter extraction.
 *
 * Key Features:
 * - Extracts full addresses and address components
 * - Compares to current location address
 * - Suggests corrections with reasoning
 * - Handles partial addresses (just city, just state, etc.)
 *
 * @version 1.0
 * @since LLM Tools Overhaul (December 2025)
 */

import {
  ARCHIVAL_BASE_SYSTEM_PROMPT,
  formatPromptWithPreprocessing,
  calibrateConfidence,
  type DataVerificationStatus,
} from './archival-base-prompt';

// =============================================================================
// ADDRESS EXTRACTION TYPES
// =============================================================================

/**
 * Extracted address from a web source
 */
export interface ExtractedAddress {
  /** Unique ID for this extraction */
  addressId: string;

  // Address components (normalized)
  street: string | null;
  city: string | null;
  county: string | null;
  state: string | null; // 2-letter code
  zipcode: string | null;

  /** Full address as a single string */
  fullAddress: string;

  /** Confidence score 0-1 */
  confidence: number;

  /** The sentence where address was found */
  contextSentence: string;

  /** Whether this appears to be THE location's address (vs just a mention) */
  isLocationAddress: boolean;

  /** Verification status */
  status: DataVerificationStatus;
}

/**
 * Suggested correction to the main location address
 */
export interface AddressCorrectionSuggestion {
  /** Which field to correct */
  field: 'street' | 'city' | 'county' | 'state' | 'zipcode';

  /** Current value on the location */
  currentValue: string | null;

  /** Suggested new value */
  suggestedValue: string;

  /** Why this correction is suggested */
  reasoning: string;

  /** Confidence in this correction */
  confidence: number;
}

/**
 * Input for address extraction
 */
export interface AddressExtractionInput {
  /** Source text to extract from */
  text: string;

  /** Location name for context */
  locationName: string;

  /** Current address on the location (for comparison) */
  currentAddress?: {
    street?: string;
    city?: string;
    county?: string;
    state?: string;
    zipcode?: string;
  };

  /** spaCy preprocessing results */
  preprocessing?: {
    gpeEntities?: string;
  };
}

/**
 * Output from address extraction
 */
export interface AddressExtractionOutput {
  /** All extracted addresses */
  addresses: ExtractedAddress[];

  /** Suggested corrections to location address */
  suggestedCorrections: AddressCorrectionSuggestion[];

  /** Extraction metadata */
  promptVersion: string;
  processingTimeMs: number;
}

// =============================================================================
// ADDRESS EXTRACTION PROMPT
// =============================================================================

/**
 * System prompt for address extraction
 */
export const ADDRESS_EXTRACTION_SYSTEM_PROMPT = `${ARCHIVAL_BASE_SYSTEM_PROMPT}

## ADDRESS EXTRACTION TASK

You are extracting addresses from documents about abandoned/historical locations. Your goal is to:
1. Find all addresses mentioned in the text
2. Identify which address (if any) is THE location's actual address
3. Compare found addresses to the current location address
4. Suggest corrections if the current address appears incorrect

### Address Component Rules

**State**: Always normalize to 2-letter code (NY, CA, TX, etc.)
**ZIP**: Must be 5 digits or 5+4 format (12345 or 12345-6789)
**City**: Title case, remove "City of" prefix
**County**: Title case, remove "County" suffix
**Street**: Keep as found, but collapse excess whitespace

### Address Relevance Scoring

An address is THE LOCATION'S ADDRESS if:
- It directly follows or precedes the location name
- It's described as "located at", "situated at", "address is"
- It's the only address in a document clearly about this location
- Context makes it clear this is where the location is/was

An address is a MENTION (not the location's address) if:
- It's an office address, mailing address, or contact address
- It's a nearby landmark or reference point
- It's in a list of multiple addresses
- It's clearly about a different entity

### Confidence Guidelines for Addresses

- 0.90-1.0: Explicit "located at [address]" with full components
- 0.75-0.89: Clear address with good context
- 0.60-0.74: Partial address or less explicit context
- 0.40-0.59: Ambiguous whether this is the location's address
- Below 0.40: Do not include - too uncertain`;

/**
 * Main prompt template for address extraction
 */
export const ADDRESS_EXTRACTION_PROMPT = `Extract all addresses from this document and determine if any correct/enhance the location's current address.

## LOCATION NAME: {locationName}

## CURRENT LOCATION ADDRESS:
{currentAddress}

## DOCUMENT:
---
{text}
---

## REQUIRED OUTPUT FORMAT (JSON):
{
  "addresses": [
    {
      "street": "123 Main Street" or null,
      "city": "Springfield" or null,
      "county": "Clark" or null,
      "state": "OH" or null,
      "zipcode": "12345" or null,
      "fullAddress": "123 Main Street, Springfield, OH 12345",
      "confidence": 0.0 to 1.0,
      "contextSentence": "The exact sentence where this address appears",
      "isLocationAddress": true or false
    }
  ],
  "suggestedCorrections": [
    {
      "field": "city" | "state" | "county" | "street" | "zipcode",
      "currentValue": "current value or null",
      "suggestedValue": "new value",
      "reasoning": "Why this correction is suggested",
      "confidence": 0.0 to 1.0
    }
  ]
}

## EXTRACTION RULES:

### 1. Find All Addresses
- Look for street addresses, city/state mentions, ZIP codes
- Include partial addresses (just city, just city+state)
- Extract each distinct address mentioned

### 2. Normalize Components
- State: Convert to 2-letter code (New York → NY)
- ZIP: Format as 5 digits or 5+4
- City: Title case, no "City of" prefix
- County: Title case, no "County" suffix

### 3. Determine Location Relevance
For each address, determine if it's the location's address:
- "located at [address]" → isLocationAddress: true
- "situated on [street]" → isLocationAddress: true
- "office at [address]" → isLocationAddress: false (office != location)
- "nearby [place] at [address]" → isLocationAddress: false

### 4. Suggest Corrections
If you find an address that differs from the current location address:
- Only suggest corrections where the found address appears MORE ACCURATE
- Provide clear reasoning
- Do not suggest corrections if both could be valid

### NOT ADDRESSES (do not extract):
- Phone numbers
- GPS coordinates
- PO Box numbers (unless clearly the location's address)
- Website URLs
- Building numbers without streets

## EXAMPLES:

INPUT (locationName: "Sterling Steel Factory"):
Current address: street=null, city="Springfield", state="OH", zipcode=null
Text: "The Sterling Steel Factory was located at 450 Industrial Drive in Springfield Township, Ohio. The factory's headquarters were at 1 Steel Plaza in Cleveland."

OUTPUT:
{
  "addresses": [
    {
      "street": "450 Industrial Drive",
      "city": "Springfield Township",
      "county": null,
      "state": "OH",
      "zipcode": null,
      "fullAddress": "450 Industrial Drive, Springfield Township, OH",
      "confidence": 0.92,
      "contextSentence": "The Sterling Steel Factory was located at 450 Industrial Drive in Springfield Township, Ohio.",
      "isLocationAddress": true
    },
    {
      "street": "1 Steel Plaza",
      "city": "Cleveland",
      "county": null,
      "state": "OH",
      "zipcode": null,
      "fullAddress": "1 Steel Plaza, Cleveland, OH",
      "confidence": 0.85,
      "contextSentence": "The factory's headquarters were at 1 Steel Plaza in Cleveland.",
      "isLocationAddress": false
    }
  ],
  "suggestedCorrections": [
    {
      "field": "street",
      "currentValue": null,
      "suggestedValue": "450 Industrial Drive",
      "reasoning": "Document explicitly states 'was located at 450 Industrial Drive'",
      "confidence": 0.92
    },
    {
      "field": "city",
      "currentValue": "Springfield",
      "suggestedValue": "Springfield Township",
      "reasoning": "Document specifies 'Springfield Township' which is more precise than 'Springfield'",
      "confidence": 0.80
    }
  ]
}

Return ONLY the JSON object. No markdown, no explanation.`;

// =============================================================================
// PROMPT BUILDERS
// =============================================================================

/**
 * Build the address extraction prompt with inputs
 */
export function buildAddressExtractionPrompt(input: AddressExtractionInput): string {
  const currentAddressStr = input.currentAddress
    ? Object.entries(input.currentAddress)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ') || 'No address on file'
    : 'No address on file';

  let prompt = ADDRESS_EXTRACTION_PROMPT
    .replace('{locationName}', input.locationName || 'Unknown')
    .replace('{currentAddress}', currentAddressStr)
    .replace('{text}', input.text);

  // Add preprocessing context if available
  if (input.preprocessing?.gpeEntities) {
    prompt = formatPromptWithPreprocessing(prompt, {
      gpeEntities: input.preprocessing.gpeEntities,
    });
  }

  return prompt;
}

// =============================================================================
// RESPONSE PARSING
// =============================================================================

/**
 * Parse LLM response into AddressExtractionOutput
 */
export function parseAddressExtractionResponse(
  response: string,
  startTime: number
): AddressExtractionOutput {
  const result: AddressExtractionOutput = {
    addresses: [],
    suggestedCorrections: [],
    promptVersion: 'address-extraction-v1',
    processingTimeMs: Date.now() - startTime,
  };

  try {
    // Extract JSON from response
    let jsonStr = response.trim();

    // Remove markdown code blocks
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }

    // Find JSON boundaries
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
    }

    const parsed = JSON.parse(jsonStr) as {
      addresses?: unknown[];
      suggestedCorrections?: unknown[];
    };

    // Parse addresses
    if (Array.isArray(parsed.addresses)) {
      result.addresses = parsed.addresses
        .filter((a): a is Record<string, unknown> => a !== null && typeof a === 'object')
        .map((a, i) => ({
          addressId: `addr-${Date.now()}-${i}`,
          street: normalizeString(a.street),
          city: normalizeString(a.city),
          county: normalizeString(a.county),
          state: normalizeState(a.state),
          zipcode: normalizeZip(a.zipcode),
          fullAddress: String(a.fullAddress || buildFullAddress(a)),
          confidence: normalizeConfidence(a.confidence),
          contextSentence: String(a.contextSentence || ''),
          isLocationAddress: Boolean(a.isLocationAddress),
          status: 'extracted' as DataVerificationStatus,
        }));
    }

    // Parse corrections
    if (Array.isArray(parsed.suggestedCorrections)) {
      result.suggestedCorrections = parsed.suggestedCorrections
        .filter((c): c is Record<string, unknown> => c !== null && typeof c === 'object')
        .map((c) => ({
          field: validateField(c.field),
          currentValue: normalizeString(c.currentValue),
          suggestedValue: String(c.suggestedValue || ''),
          reasoning: String(c.reasoning || ''),
          confidence: normalizeConfidence(c.confidence),
        }));
    }
  } catch (e) {
    console.error('Failed to parse address extraction response:', e);
  }

  return result;
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function normalizeString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str.length > 0 ? str : null;
}

function normalizeState(value: unknown): string | null {
  const str = normalizeString(value);
  if (!str) return null;

  // Already 2-letter code
  if (/^[A-Z]{2}$/.test(str.toUpperCase())) {
    return str.toUpperCase();
  }

  // Full state name → code mapping
  const stateMap: Record<string, string> = {
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

  return stateMap[str.toLowerCase()] || str.toUpperCase().substring(0, 2);
}

function normalizeZip(value: unknown): string | null {
  const str = normalizeString(value);
  if (!str) return null;

  // Extract digits
  const digits = str.replace(/\D/g, '');

  if (digits.length === 5) {
    return digits;
  } else if (digits.length === 9) {
    return `${digits.substring(0, 5)}-${digits.substring(5)}`;
  }

  return null;
}

function normalizeConfidence(value: unknown): number {
  const num = Number(value);
  if (isNaN(num)) return 0.5;
  if (num > 1) return num / 100;
  return Math.max(0, Math.min(1, num));
}

function validateField(value: unknown): 'street' | 'city' | 'county' | 'state' | 'zipcode' {
  const str = String(value || '').toLowerCase();
  const validFields = ['street', 'city', 'county', 'state', 'zipcode'] as const;
  return validFields.includes(str as typeof validFields[number])
    ? (str as typeof validFields[number])
    : 'street';
}

function buildFullAddress(addr: Record<string, unknown>): string {
  const parts: string[] = [];
  if (addr.street) parts.push(String(addr.street));
  if (addr.city) parts.push(String(addr.city));
  if (addr.state) parts.push(String(addr.state));
  if (addr.zipcode) parts.push(String(addr.zipcode));
  return parts.join(', ');
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  ADDRESS_EXTRACTION_SYSTEM_PROMPT,
  ADDRESS_EXTRACTION_PROMPT,
};
