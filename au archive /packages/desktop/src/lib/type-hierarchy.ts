/**
 * Category Hierarchy Map
 *
 * Defines the relationship between location categories and their classes.
 * Used for auto-filling the category field when user enters a known class.
 */

export const CATEGORY_HIERARCHY: Record<string, string[]> = {
  'Faith': ['Church', 'Chapel', 'Monastery', 'Temple', 'Synagogue', 'Mosque', 'Cathedral', 'Convent', 'Abbey', 'Shrine'],
  'Medical': ['Hospital', 'Sanatorium', 'Asylum', 'Psychiatric', 'Clinic', 'Infirmary', 'Nursing Home', 'Sanitarium'],
  'Industrial': ['Factory', 'Mill', 'Foundry', 'Warehouse', 'Power Plant', 'Refinery', 'Mine', 'Quarry', 'Smelter'],
  'Education': ['School', 'College', 'University', 'Academy', 'Seminary', 'Library', 'Gymnasium'],
  'Residential': ['Hotel', 'Mansion', 'Resort', 'Apartment', 'Dormitory', 'Orphanage', 'Motel', 'Inn', 'Lodge'],
  'Government': ['Courthouse', 'Prison', 'Jail', 'Post Office', 'Armory', 'City Hall', 'Penitentiary'],
  'Commercial': ['Theater', 'Bank', 'Department Store', 'Office Building', 'Shopping Center', 'Restaurant'],
  'Transportation': ['Train Station', 'Airport', 'Bus Station', 'Depot', 'Terminal', 'Hangar'],
  'Military': ['Base', 'Fort', 'Bunker', 'Barracks', 'Arsenal', 'Missile Silo'],
  'Recreation': ['Amusement Park', 'Stadium', 'Pool', 'Country Club', 'Golf Course', 'Skating Rink', 'Bowling Alley'],
  'Agricultural': ['Farm', 'Barn', 'Silo', 'Granary', 'Dairy', 'Greenhouse'],
};

// Build reverse lookup: class (lowercase) → category
const CLASS_TO_CATEGORY: Record<string, string> = {};
for (const [category, classes] of Object.entries(CATEGORY_HIERARCHY)) {
  for (const cls of classes) {
    CLASS_TO_CATEGORY[cls.toLowerCase()] = category;
  }
}

/**
 * Get the parent category for a given class.
 * Returns null if class is not in the hierarchy.
 *
 * @example
 * getCategoryForClass('church') // Returns 'Faith'
 * getCategoryForClass('hospital') // Returns 'Medical'
 * getCategoryForClass('unknown') // Returns null
 */
export function getCategoryForClass(cls: string): string | null {
  if (!cls) return null;
  return CLASS_TO_CATEGORY[cls.toLowerCase().trim()] || null;
}

/**
 * Get all known categories.
 */
export function getAllCategories(): string[] {
  return Object.keys(CATEGORY_HIERARCHY);
}

/**
 * Get all known classes for a given category.
 */
export function getClassesForCategory(category: string): string[] {
  return CATEGORY_HIERARCHY[category] || [];
}
