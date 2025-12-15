/**
 * Default system prompts for Data Engine auto-tagging categories.
 * Users can customize these via the Settings > Data Engine > Auto Tagging UI.
 *
 * Prompts are stored in the settings table with keys:
 *   dataengine_prompt_{category}
 */

export interface CategoryPrompt {
  systemPrompt: string;
  enabled: boolean;
  lastModified: string; // ISO8601
  modifiedBy: string;   // username
}

export const CATEGORY_KEYS = [
  'images',
  'video',
  'dates',
  'addresses',
  'people',
  'companies',
] as const;

export type CategoryKey = typeof CATEGORY_KEYS[number];

export const DEFAULT_PROMPTS: Record<CategoryKey, string> = {
  images: `You are an image analysis assistant for an abandoned places archive.
Analyze the image and extract:
- Location type (factory, hospital, school, church, etc.)
- Architectural era and style
- Current condition (decay level, hazards, nature reclaim)
- Notable features (graffiti, equipment, structural damage)
- View type (interior, exterior, aerial, detail)

Return structured JSON with confidence scores.`,

  video: `You are a video analysis assistant for an abandoned places archive.
Analyze the video content and extract:
- Location walkthrough summary
- Key rooms or areas shown
- Notable features and conditions
- Any visible text or signage
- Estimated era of the building

Return structured JSON with timestamps for key moments.`,

  dates: `You are a date extraction assistant for an abandoned places archive.
Extract dates from the provided text, categorizing them as:
- build_date: When the location was constructed
- opening: When the location opened for operation
- closure: When the location closed or was abandoned
- demolition: When the location was demolished
- renovation: Restoration or repair periods
- event: Notable incidents (fires, floods, accidents)
- visit: When explorers visited

Only extract dates with clear verb context. Ignore numbers that are:
- Measurements, dimensions, or counts
- Phone numbers, addresses, or route numbers
- Currency amounts or prices

Return structured JSON with confidence scores and source quotes.`,

  addresses: `You are an address extraction assistant for an abandoned places archive.
Extract and normalize addresses from the provided text:
- Street address (number and street name)
- City or town
- State (2-letter code)
- ZIP code (5 or 9 digit)
- County
- Country (default: USA)

Handle partial addresses gracefully. Normalize state names to codes.
Return structured JSON with confidence scores.`,

  people: `You are a person extraction assistant for an abandoned places archive.
Extract notable people mentioned in relation to the location:
- Owners (past and present)
- Architects and builders
- Notable occupants or employees
- Photographers and explorers
- Historians and researchers

Include:
- Full name (normalized)
- Role or relationship to location
- Date range of involvement (if known)
- Source reference

Return structured JSON with confidence scores.`,

  companies: `You are a company extraction assistant for an abandoned places archive.
Extract organizations mentioned in relation to the location:
- Original operators
- Subsequent owners
- Development companies
- Preservation groups
- Government agencies

Include:
- Company name (normalized)
- Type (corporation, LLC, nonprofit, government)
- Role (builder, owner, operator, buyer)
- Date range of involvement (if known)
- Source reference

Return structured JSON with confidence scores.`,
};

export const CATEGORY_LABELS: Record<CategoryKey, string> = {
  images: 'Images',
  video: 'Video',
  dates: 'Dates',
  addresses: 'Addresses',
  people: 'People',
  companies: 'Companies',
};

export const CATEGORY_ICONS: Record<CategoryKey, string> = {
  images: 'photo',
  video: 'video',
  dates: 'calendar',
  addresses: 'location',
  people: 'person',
  companies: 'building',
};

/**
 * Get the settings key for a category's prompt.
 */
export function getPromptKey(category: CategoryKey): string {
  return `dataengine_prompt_${category}`;
}

/**
 * Parse a stored prompt value, returning defaults if invalid.
 */
export function parseStoredPrompt(value: string | null, category: CategoryKey): CategoryPrompt {
  if (!value) {
    return {
      systemPrompt: DEFAULT_PROMPTS[category],
      enabled: true,
      lastModified: new Date().toISOString(),
      modifiedBy: 'system',
    };
  }

  try {
    const parsed = JSON.parse(value);
    return {
      systemPrompt: parsed.systemPrompt || DEFAULT_PROMPTS[category],
      enabled: parsed.enabled ?? true,
      lastModified: parsed.lastModified || new Date().toISOString(),
      modifiedBy: parsed.modifiedBy || 'system',
    };
  } catch {
    return {
      systemPrompt: DEFAULT_PROMPTS[category],
      enabled: true,
      lastModified: new Date().toISOString(),
      modifiedBy: 'system',
    };
  }
}
