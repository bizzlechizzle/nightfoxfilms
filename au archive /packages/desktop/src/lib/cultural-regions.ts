/**
 * Cultural Regions by State
 * Per DECISION-011: Predefined cultural regions for Location Box UI
 * These are user-selectable, subjective regions that do NOT count toward Location completeness.
 */

export const CULTURAL_REGIONS: Record<string, string[]> = {
  // New York
  'NY': [
    'Finger Lakes',
    'Hudson Valley',
    'Southern Tier',
    'Adirondacks',
    'Capital Region',
    'Western NY',
    'Central NY',
    'North Country',
    'Long Island',
    'NYC Metro',
    'Catskills',
    'Mohawk Valley',
    'Thousand Islands'
  ],
  // Pennsylvania
  'PA': [
    'Poconos',
    'Lehigh Valley',
    'Coal Region',
    'Dutch Country',
    'Pittsburgh Metro',
    'Philadelphia Metro',
    'Laurel Highlands',
    'Lake Erie Region',
    'Susquehanna Valley',
    'Endless Mountains'
  ],
  // New Jersey
  'NJ': [
    'Pine Barrens',
    'Jersey Shore',
    'Skylands',
    'Gateway Region',
    'Delaware River Region',
    'Greater Atlantic City'
  ],
  // Ohio
  'OH': [
    'Northeast Ohio',
    'Northwest Ohio',
    'Central Ohio',
    'Southwest Ohio',
    'Southeast Ohio',
    'Appalachian Ohio',
    'Lake Erie Region'
  ],
  // Michigan
  'MI': [
    'Upper Peninsula',
    'Northern Michigan',
    'Metro Detroit',
    'West Michigan',
    'Mid-Michigan',
    'Thumb Region',
    'Copper Country'
  ],
  // Massachusetts
  'MA': [
    'Greater Boston',
    'Cape Cod',
    'Berkshires',
    'Pioneer Valley',
    'North Shore',
    'South Shore',
    'Merrimack Valley'
  ],
  // Vermont
  'VT': [
    'Green Mountains',
    'Northeast Kingdom',
    'Champlain Valley',
    'Southern Vermont'
  ],
  // New Hampshire
  'NH': [
    'White Mountains',
    'Lakes Region',
    'Seacoast',
    'Monadnock Region',
    'Great North Woods'
  ],
  // Maine
  'ME': [
    'Down East',
    'Midcoast',
    'Kennebec Valley',
    'Western Mountains',
    'Aroostook County',
    'Greater Portland'
  ],
  // Connecticut
  'CT': [
    'Litchfield Hills',
    'Connecticut River Valley',
    'Gold Coast',
    'Quiet Corner',
    'Greater Hartford',
    'Greater New Haven'
  ],
  // West Virginia
  'WV': [
    'Eastern Panhandle',
    'Northern Panhandle',
    'Potomac Highlands',
    'Mountain State',
    'Metro Valley'
  ],
  // Virginia
  'VA': [
    'Northern Virginia',
    'Hampton Roads',
    'Shenandoah Valley',
    'Blue Ridge',
    'Piedmont',
    'Southwest Virginia',
    'Richmond Metro'
  ],
  // Maryland
  'MD': [
    'Western Maryland',
    'Eastern Shore',
    'Baltimore Metro',
    'Southern Maryland',
    'Capital Region'
  ],
  // Rhode Island
  'RI': [
    'Greater Providence',
    'South County',
    'Newport County',
    'Blackstone Valley'
  ]
};

/**
 * Directional regions (auto-assigned based on GPS coordinates)
 * These are used for the "Region" field in the Area section
 */
export const DIRECTIONAL_REGIONS = [
  'North',
  'South',
  'East',
  'West',
  'Northeast',
  'Northwest',
  'Southeast',
  'Southwest',
  'Central',
  'North Central',
  'South Central',
  'East Central',
  'West Central'
] as const;

export type DirectionalRegion = typeof DIRECTIONAL_REGIONS[number];

/**
 * Get cultural regions for a given state
 * Returns empty array if state not found
 */
export function getCulturalRegionsForState(state: string | null | undefined): string[] {
  if (!state) return [];
  return CULTURAL_REGIONS[state.toUpperCase()] || [];
}

/**
 * Check if a cultural region is valid for a given state
 */
export function isValidCulturalRegion(state: string | null | undefined, region: string): boolean {
  if (!state || !region) return false;
  const regions = getCulturalRegionsForState(state);
  return regions.includes(region);
}
