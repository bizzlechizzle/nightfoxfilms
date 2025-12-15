/**
 * Token Set Ratio Service
 *
 * Provides word-order independent fuzzy matching for location names.
 * Solves the problem where "Union Station - Lockport" doesn't match
 * "Lockport Union Train Station" using character-based algorithms.
 *
 * Algorithm: Token Set Ratio (from FuzzyWuzzy/TheFuzz library)
 * - Tokenizes both strings into word sets
 * - Finds intersection and remainders
 * - Compares: intersection vs (intersection + remainder1) vs (intersection + remainder2)
 * - Returns MAX score
 *
 * Also includes:
 * - Blocking word detection (North/South, Building A/B)
 * - Generic name detection (House, Church, Factory)
 * - Combined scoring (JW + Token Set)
 */

import { jaroWinklerSimilarity } from './jaro-winkler-service';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Generic location names that shouldn't match on name alone.
 * These require GPS confirmation (within 25m) to be considered duplicates.
 */
export const GENERIC_NAMES = new Set([
  'house',
  'church',
  'school',
  'factory',
  'industrial',
  'industry',
  'building',
  'farm',
  'barn',
  'mill',
  'warehouse',
  'store',
  'shop',
  'hotel',
  'motel',
  'hospital',
  'office',
  'station',
  'tower',
  'plant',
  'center',
  'site',
  'place',
  'location',
  'point',
  'cars',
  'trains',
  'trucks',
]);

/**
 * Blocking words that indicate DIFFERENT places even with similar names.
 * "North Factory" and "South Factory" are NOT duplicates.
 */
export const BLOCKING_WORDS = {
  /** Direction words - opposite directions = different place */
  directions: new Set(['north', 'south', 'east', 'west', 'upper', 'lower', 'inner', 'outer']),

  /** Temporal words - old vs new = different place */
  temporal: new Set(['old', 'new', 'former', 'current', 'original', 'modern', 'historic']),

  /** Numbered words - 1 vs 2 = different place */
  numbered: new Set(['first', 'second', 'third', 'fourth', 'fifth', '1st', '2nd', '3rd', '4th', '5th']),
};

/**
 * Patterns for building/unit identifiers.
 * "Building A" and "Building B" are different places.
 * "Unit 1" and "Unit 2" are different places.
 */
export const IDENTIFIER_PATTERNS = [
  /^building\s*[a-z0-9]+$/i,
  /^unit\s*[a-z0-9]+$/i,
  /^wing\s*[a-z0-9]+$/i,
  /^ward\s*[a-z0-9]+$/i,
  /^phase\s*[a-z0-9]+$/i,
  /^section\s*[a-z0-9]+$/i,
  /^block\s*[a-z0-9]+$/i,
  /^lot\s*[a-z0-9]+$/i,
];

// ============================================================================
// SUGGESTION FILTERING
// ============================================================================

/**
 * Generic words that alone (or with region) are not useful as suggestions.
 * These are typically Google Maps/Street View pins without real documentation.
 */
export const SUGGESTION_GENERIC_WORDS = new Set([
  // From GENERIC_NAMES plus additional patterns found in map data
  'house', 'houses', 'church', 'churches', 'school', 'schools',
  'factory', 'industrial', 'industry', 'building', 'farm', 'farms',
  'barn', 'mill', 'warehouse', 'store', 'shop', 'hotel', 'motel',
  'hospital', 'office', 'station', 'tower', 'plant', 'center',
  'site', 'place', 'location', 'point', 'cars', 'trains', 'trucks',
  'quarry', 'cabin', 'greenhouse', 'theater', 'trails', 'trail',
]);

/**
 * Region/city names that when combined with generic words = placeholder entry.
 * "Buffalo Church", "House - CNY", "Industrial - Syracuse" should all be filtered.
 */
export const SUGGESTION_REGION_WORDS = new Set([
  // Abbreviations
  'cny', 'wny', 'nny', 'eny', 'pa', 'ny', 'in',
  // Cities/regions from map data
  'fingerlakes', 'buffalo', 'syracuse', 'rochester', 'binghamton',
  'pittsburgh', 'albany', 'sayre', 'elmira', 'waterloo', 'lockport',
  'cortland', 'maine', 'ohio',
]);

// ============================================================================
// TOKENIZATION
// ============================================================================

/**
 * Tokenize a string into lowercase words, removing punctuation.
 * "Union Station - Lockport" → ["union", "station", "lockport"]
 */
export function tokenize(str: string): string[] {
  if (!str) return [];

  return str
    .toLowerCase()
    // Replace punctuation with spaces
    .replace(/[^\w\s]/g, ' ')
    // Split on whitespace
    .split(/\s+/)
    // Remove empty strings
    .filter((token) => token.length > 0)
    // Remove single characters (except numbers)
    .filter((token) => token.length > 1 || /^\d$/.test(token));
}

/**
 * Sort tokens alphabetically and join.
 * ["union", "station", "lockport"] → "lockport station union"
 */
export function sortedTokenString(tokens: string[]): string {
  return [...tokens].sort().join(' ');
}

// ============================================================================
// TOKEN SET RATIO ALGORITHM
// ============================================================================

/**
 * Calculate Token Sort Ratio.
 * Sorts both token sets alphabetically, then compares.
 *
 * "Union Station" vs "Station Union" → 100% match
 */
export function tokenSortRatio(s1: string, s2: string): number {
  const tokens1 = tokenize(s1);
  const tokens2 = tokenize(s2);

  if (tokens1.length === 0 && tokens2.length === 0) return 1;
  if (tokens1.length === 0 || tokens2.length === 0) return 0;

  const sorted1 = sortedTokenString(tokens1);
  const sorted2 = sortedTokenString(tokens2);

  return jaroWinklerSimilarity(sorted1, sorted2);
}

/**
 * Calculate Token Set Ratio (main algorithm).
 *
 * Steps:
 * 1. Tokenize both strings
 * 2. Find intersection (shared words)
 * 3. Find remainders (unique to each)
 * 4. Build three comparison strings:
 *    - intersection only
 *    - intersection + remainder1
 *    - intersection + remainder2
 * 5. Return MAX of all pairwise Jaro-Winkler comparisons
 *
 * Example: "Union Station - Lockport" vs "Lockport Union Train Station"
 * - tokens1: [union, station, lockport]
 * - tokens2: [lockport, union, train, station]
 * - intersection: [lockport, station, union]
 * - remainder1: []
 * - remainder2: [train]
 * - Comparisons yield very high match
 *
 * @returns Score from 0-1 (multiply by 100 for percentage)
 */
export function tokenSetRatio(s1: string, s2: string): number {
  const tokens1 = new Set(tokenize(s1));
  const tokens2 = new Set(tokenize(s2));

  if (tokens1.size === 0 && tokens2.size === 0) return 1;
  if (tokens1.size === 0 || tokens2.size === 0) return 0;

  // Find intersection and remainders
  const intersection = new Set<string>();
  const remainder1 = new Set<string>();
  const remainder2 = new Set<string>();

  for (const token of tokens1) {
    if (tokens2.has(token)) {
      intersection.add(token);
    } else {
      remainder1.add(token);
    }
  }

  for (const token of tokens2) {
    if (!tokens1.has(token)) {
      remainder2.add(token);
    }
  }

  // Build comparison strings
  const intersectionSorted = sortedTokenString([...intersection]);
  const combined1 = sortedTokenString([...intersection, ...remainder1]);
  const combined2 = sortedTokenString([...intersection, ...remainder2]);

  // If intersection is empty, fall back to token sort ratio
  if (intersection.size === 0) {
    return tokenSortRatio(s1, s2);
  }

  // Calculate all pairwise similarities
  const scores: number[] = [];

  // intersection vs combined1
  if (intersectionSorted && combined1) {
    scores.push(jaroWinklerSimilarity(intersectionSorted, combined1));
  }

  // intersection vs combined2
  if (intersectionSorted && combined2) {
    scores.push(jaroWinklerSimilarity(intersectionSorted, combined2));
  }

  // combined1 vs combined2
  if (combined1 && combined2) {
    scores.push(jaroWinklerSimilarity(combined1, combined2));
  }

  // If all strings are identical (perfect match case)
  if (intersectionSorted === combined1 && combined1 === combined2) {
    return 1;
  }

  return Math.max(...scores, 0);
}

/**
 * Calculate partial token ratio.
 * Useful when one name is a substring of another.
 *
 * "Chevy" vs "Chevrolet Biscayne" → high match because "Chevy" relates to "Chevrolet"
 */
export function partialTokenRatio(s1: string, s2: string): number {
  const tokens1 = tokenize(s1);
  const tokens2 = tokenize(s2);

  if (tokens1.length === 0 || tokens2.length === 0) return 0;

  // For each token in shorter string, find best match in longer string
  const shorter = tokens1.length <= tokens2.length ? tokens1 : tokens2;
  const longer = tokens1.length > tokens2.length ? tokens1 : tokens2;

  let totalScore = 0;
  for (const shortToken of shorter) {
    let bestMatch = 0;
    for (const longToken of longer) {
      const score = jaroWinklerSimilarity(shortToken, longToken);
      bestMatch = Math.max(bestMatch, score);
    }
    totalScore += bestMatch;
  }

  return totalScore / shorter.length;
}

// ============================================================================
// BLOCKING WORD DETECTION
// ============================================================================

/**
 * Extract blocking words from a name.
 * Returns object with categorized blocking words found.
 */
export function extractBlockingWords(name: string): {
  directions: Set<string>;
  temporal: Set<string>;
  numbered: Set<string>;
  identifiers: string[];
} {
  const tokens = tokenize(name);

  const result = {
    directions: new Set<string>(),
    temporal: new Set<string>(),
    numbered: new Set<string>(),
    identifiers: [] as string[],
  };

  for (const token of tokens) {
    if (BLOCKING_WORDS.directions.has(token)) {
      result.directions.add(token);
    }
    if (BLOCKING_WORDS.temporal.has(token)) {
      result.temporal.add(token);
    }
    if (BLOCKING_WORDS.numbered.has(token)) {
      result.numbered.add(token);
    }
  }

  // Check for identifier patterns (e.g., "Building A")
  for (const pattern of IDENTIFIER_PATTERNS) {
    const fullName = name.toLowerCase();
    const match = fullName.match(pattern);
    if (match) {
      result.identifiers.push(match[0]);
    }
  }

  // Also check two-word patterns like "building a", "unit 2"
  for (let i = 0; i < tokens.length - 1; i++) {
    const twoWord = `${tokens[i]} ${tokens[i + 1]}`;
    for (const pattern of IDENTIFIER_PATTERNS) {
      if (pattern.test(twoWord)) {
        result.identifiers.push(twoWord);
        break;
      }
    }
  }

  return result;
}

/**
 * Check if two names have blocking word conflicts.
 *
 * Returns true if names should NOT be considered duplicates due to:
 * - Opposite directions: "North Factory" vs "South Factory"
 * - Different identifiers: "Building A" vs "Building B"
 * - Temporal conflicts: "Old Mill" vs "New Mill"
 *
 * @returns Object with conflict status and reason
 */
export function checkBlockingConflict(
  name1: string,
  name2: string
): { hasConflict: boolean; reason?: string; details?: string } {
  const blocking1 = extractBlockingWords(name1);
  const blocking2 = extractBlockingWords(name2);

  // Check direction conflicts
  const oppositeDirections: [string, string][] = [
    ['north', 'south'],
    ['east', 'west'],
    ['upper', 'lower'],
    ['inner', 'outer'],
  ];

  for (const [dir1, dir2] of oppositeDirections) {
    if (
      (blocking1.directions.has(dir1) && blocking2.directions.has(dir2)) ||
      (blocking1.directions.has(dir2) && blocking2.directions.has(dir1))
    ) {
      return {
        hasConflict: true,
        reason: 'opposite_direction',
        details: `"${dir1}" vs "${dir2}" indicates different locations`,
      };
    }
  }

  // Check temporal conflicts
  const oppositeTemporal: [string, string][] = [
    ['old', 'new'],
    ['former', 'current'],
    ['original', 'modern'],
    ['historic', 'modern'],
  ];

  for (const [temp1, temp2] of oppositeTemporal) {
    if (
      (blocking1.temporal.has(temp1) && blocking2.temporal.has(temp2)) ||
      (blocking1.temporal.has(temp2) && blocking2.temporal.has(temp1))
    ) {
      return {
        hasConflict: true,
        reason: 'temporal_conflict',
        details: `"${temp1}" vs "${temp2}" indicates different time periods`,
      };
    }
  }

  // Check identifier conflicts (Building A vs Building B)
  if (blocking1.identifiers.length > 0 && blocking2.identifiers.length > 0) {
    for (const id1 of blocking1.identifiers) {
      for (const id2 of blocking2.identifiers) {
        // Same prefix but different identifier
        const prefix1 = id1.replace(/[a-z0-9]+$/i, '').trim();
        const prefix2 = id2.replace(/[a-z0-9]+$/i, '').trim();
        const suffix1 = id1.replace(prefix1, '').trim();
        const suffix2 = id2.replace(prefix2, '').trim();

        if (prefix1 === prefix2 && suffix1 !== suffix2) {
          return {
            hasConflict: true,
            reason: 'identifier_conflict',
            details: `"${id1}" vs "${id2}" are different units`,
          };
        }
      }
    }
  }

  // Check numbered conflicts (first vs second)
  const numberedOrder = ['first', 'second', 'third', 'fourth', 'fifth', '1st', '2nd', '3rd', '4th', '5th'];
  const num1 = [...blocking1.numbered].find((n) => numberedOrder.includes(n));
  const num2 = [...blocking2.numbered].find((n) => numberedOrder.includes(n));

  if (num1 && num2 && num1 !== num2) {
    return {
      hasConflict: true,
      reason: 'numbered_conflict',
      details: `"${num1}" vs "${num2}" are different ordinals`,
    };
  }

  return { hasConflict: false };
}

/**
 * Simple boolean check for blocking conflicts.
 */
export function hasBlockingConflict(name1: string, name2: string): boolean {
  return checkBlockingConflict(name1, name2).hasConflict;
}

// ============================================================================
// GENERIC NAME DETECTION
// ============================================================================

/**
 * Check if a name is generic (e.g., "House", "Church", "Factory").
 * Generic names require GPS confirmation, not just name matching.
 */
export function isGenericName(name: string): boolean {
  if (!name) return true;

  const cleaned = name
    .toLowerCase()
    .trim()
    .replace(/\?$/, ''); // Remove trailing question mark

  return GENERIC_NAMES.has(cleaned);
}

/**
 * Check if a name contains uncertainty markers.
 * "House?" or "School?" indicate the user wasn't sure.
 */
export function hasUncertainty(name: string): boolean {
  if (!name) return false;
  return name.trim().endsWith('?');
}

/**
 * Check if a name is a placeholder (e.g., "Point 123").
 */
export function isPlaceholder(name: string): boolean {
  if (!name) return false;
  return /^point\s*\d+$/i.test(name.trim());
}

/**
 * Get name quality flags for matching decisions.
 */
export function getNameFlags(name: string): {
  isGeneric: boolean;
  hasUncertainty: boolean;
  isPlaceholder: boolean;
  requiresGpsMatch: boolean;
  requiresUserReview: boolean;
} {
  const isGeneric = isGenericName(name);
  const uncertain = hasUncertainty(name);
  const placeholder = isPlaceholder(name);

  return {
    isGeneric,
    hasUncertainty: uncertain,
    isPlaceholder: placeholder,
    // Generic names need GPS to confirm (25m threshold)
    requiresGpsMatch: isGeneric,
    // Uncertain or placeholder names need user review
    requiresUserReview: uncertain || placeholder,
  };
}

/**
 * Check if a name should be excluded from reference map suggestions.
 * Filters out non-descriptive 1-3 word placeholder names that dilute search results.
 *
 * Excludes:
 * - Single generic words: "House", "Church", "Industry"
 * - Generic + region combos: "Buffalo Church", "House - CNY", "Industrial - Syracuse"
 * - Generic with question marks: "House?", "School?"
 * - Numbered placeholders: "Point 155", "School 75"
 * - Coordinate strings and plus codes
 * - Off-topic trails: "Off Road Trails"
 *
 * @param name - The reference map point name to check
 * @returns true if name should be EXCLUDED from suggestions
 */
export function shouldExcludeFromSuggestions(name: string): boolean {
  if (!name) return true;

  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  const words = tokenize(trimmed);

  // Only filter 1-3 word names; 4+ words are descriptive enough
  if (words.length > 3) return false;

  // Single generic word: "House", "Church", "Industry"
  if (words.length === 1) {
    if (SUGGESTION_GENERIC_WORDS.has(lower)) return true;
    // Also check without trailing 's' for plurals: "Houses" -> "house"
    if (SUGGESTION_GENERIC_WORDS.has(lower.replace(/s$/, ''))) return true;
  }

  // Generic with question mark: "House?", "School?", "Power Plant?"
  if (trimmed.endsWith('?') && words.length <= 2) {
    const baseWord = words[0];
    if (SUGGESTION_GENERIC_WORDS.has(baseWord)) return true;
  }

  // Generic + region in ANY order: "House - CNY", "Buffalo Church", "Syracuse School"
  if (words.length >= 2 && words.length <= 3) {
    const hasGeneric = words.some((w) => SUGGESTION_GENERIC_WORDS.has(w));
    const hasRegion = words.some((w) => SUGGESTION_REGION_WORDS.has(w));
    if (hasGeneric && hasRegion) return true;
  }

  // Point/Location/Site/Marker + number: "Point 155", "Site 12" (but NOT "School 75" - real school names!)
  if (/^(point|location|site|marker)\s*\d+$/i.test(trimmed)) return true;

  // Coordinate patterns: "43.259, -79.05" or similar
  if (/^-?\d+\.\d+,?\s*-?\d+\.\d+$/.test(trimmed)) return true;

  // Google Plus Codes: "4RR6+2R", "22CR+9G"
  if (/^[A-Z0-9]{4,}\+[A-Z0-9]+$/i.test(trimmed)) return true;

  // Off-topic trails
  if (/trail/i.test(trimmed)) return true;

  return false;
}

// ============================================================================
// COMBINED SCORING
// ============================================================================

/**
 * Match result with detailed breakdown.
 */
export interface NameMatchResult {
  /** Final combined score (0-1) */
  score: number;
  /** Jaro-Winkler score */
  jaroWinkler: number;
  /** Token Set Ratio score */
  tokenSetRatio: number;
  /** Token Sort Ratio score */
  tokenSortRatio: number;
  /** Whether match is blocked by conflicting words */
  blocked: boolean;
  /** Blocking reason if blocked */
  blockReason?: string;
  /** Shared tokens between names */
  sharedTokens: string[];
  /** Unique tokens in name1 */
  uniqueTokens1: string[];
  /** Unique tokens in name2 */
  uniqueTokens2: string[];
  /** Name1 flags */
  name1Flags: ReturnType<typeof getNameFlags>;
  /** Name2 flags */
  name2Flags: ReturnType<typeof getNameFlags>;
  /** Whether match requires GPS confirmation */
  requiresGpsConfirm: boolean;
  /** Whether match requires user review */
  requiresUserReview: boolean;
}

/**
 * Calculate combined name match score with full details.
 *
 * Uses maximum of Jaro-Winkler and Token Set Ratio to handle both:
 * - Character-level typos (JW is better)
 * - Word reordering (TSR is better)
 *
 * Also checks for blocking conflicts and generic names.
 *
 * @param name1 First name
 * @param name2 Second name
 * @returns Full match result with breakdown
 */
export function calculateNameMatch(name1: string, name2: string): NameMatchResult {
  // Calculate all similarity scores
  const jw = jaroWinklerSimilarity(name1, name2);
  const tsr = tokenSetRatio(name1, name2);
  const tsort = tokenSortRatio(name1, name2);

  // Get tokens for breakdown
  const tokens1 = new Set(tokenize(name1));
  const tokens2 = new Set(tokenize(name2));

  const sharedTokens: string[] = [];
  const uniqueTokens1: string[] = [];
  const uniqueTokens2: string[] = [];

  for (const t of tokens1) {
    if (tokens2.has(t)) {
      sharedTokens.push(t);
    } else {
      uniqueTokens1.push(t);
    }
  }
  for (const t of tokens2) {
    if (!tokens1.has(t)) {
      uniqueTokens2.push(t);
    }
  }

  // Check blocking conflicts
  const blocking = checkBlockingConflict(name1, name2);

  // Get name flags
  const name1Flags = getNameFlags(name1);
  const name2Flags = getNameFlags(name2);

  // Determine if blocked
  const blocked = blocking.hasConflict;

  // Calculate final score (0 if blocked)
  const rawScore = Math.max(jw, tsr, tsort);
  const score = blocked ? 0 : rawScore;

  // Determine requirements
  const requiresGpsConfirm = name1Flags.requiresGpsMatch || name2Flags.requiresGpsMatch;
  const requiresUserReview =
    name1Flags.requiresUserReview || name2Flags.requiresUserReview || blocked;

  return {
    score,
    jaroWinkler: jw,
    tokenSetRatio: tsr,
    tokenSortRatio: tsort,
    blocked,
    blockReason: blocking.details,
    sharedTokens,
    uniqueTokens1,
    uniqueTokens2,
    name1Flags,
    name2Flags,
    requiresGpsConfirm,
    requiresUserReview,
  };
}

/**
 * Simple combined score function.
 * Returns max of Jaro-Winkler and Token Set Ratio.
 * Returns 0 if blocking conflict detected.
 *
 * @param name1 First name
 * @param name2 Second name
 * @returns Score from 0-1
 */
export function combinedNameScore(name1: string, name2: string): number {
  if (hasBlockingConflict(name1, name2)) {
    return 0;
  }
  return Math.max(jaroWinklerSimilarity(name1, name2), tokenSetRatio(name1, name2));
}

/**
 * Check if two names are a match at the given threshold.
 * Incorporates blocking word detection.
 *
 * @param name1 First name
 * @param name2 Second name
 * @param threshold Minimum score (default 0.80)
 * @returns True if names match above threshold and no blocking conflict
 */
export function isNameMatch(name1: string, name2: string, threshold = 0.8): boolean {
  return combinedNameScore(name1, name2) >= threshold;
}

// ============================================================================
// MULTI-SIGNAL CONFIDENCE
// ============================================================================

/**
 * Multi-signal match input.
 */
export interface MultiSignalInput {
  /** Name of first location */
  name1: string;
  /** Name of second location */
  name2: string;
  /** Latitude of first location */
  lat1?: number | null;
  /** Longitude of first location */
  lng1?: number | null;
  /** Latitude of second location */
  lat2?: number | null;
  /** Longitude of second location */
  lng2?: number | null;
  /** State code of first location (2-letter) */
  state1?: string | null;
  /** State code of second location (2-letter) */
  state2?: string | null;
  /** County of first location */
  county1?: string | null;
  /** County of second location */
  county2?: string | null;
}

/**
 * Multi-signal confidence result.
 */
export interface MultiSignalResult {
  /** Total confidence score (0-100) */
  totalScore: number;
  /** GPS signal contribution */
  gpsScore: number;
  /** Name signal contribution */
  nameScore: number;
  /** State/county signal contribution */
  locationScore: number;
  /** Distance in meters (if GPS available) */
  distanceMeters?: number;
  /** Name match details */
  nameMatch: NameMatchResult;
  /** Recommended action */
  action: 'auto_merge' | 'user_review' | 'no_match';
  /** Confidence tier */
  tier: 'high' | 'medium' | 'low' | 'none';
}

/**
 * Scoring weights for multi-signal matching.
 */
export const SIGNAL_WEIGHTS = {
  /** GPS proximity: max 40 points */
  GPS_MAX: 40,
  /** Name similarity: max 35 points */
  NAME_MAX: 35,
  /** State/county match: max 25 points */
  LOCATION_MAX: 25,

  /** Thresholds for GPS scoring */
  GPS_TIERS: {
    CLOSE: { distance: 25, score: 40 }, // <25m = 40 points
    NEAR: { distance: 150, score: 30 }, // <150m = 30 points
    MEDIUM: { distance: 500, score: 20 }, // <500m = 20 points
    FAR: { distance: 1000, score: 10 }, // <1000m = 10 points
  },

  /** Thresholds for name scoring */
  NAME_TIERS: {
    EXACT: { threshold: 0.95, score: 35 }, // 95%+ = 35 points
    HIGH: { threshold: 0.85, score: 28 }, // 85%+ = 28 points
    MEDIUM: { threshold: 0.75, score: 20 }, // 75%+ = 20 points
    LOW: { threshold: 0.65, score: 10 }, // 65%+ = 10 points
  },

  /** Thresholds for action */
  ACTION_THRESHOLDS: {
    AUTO_MERGE: 70, // 70+ = auto merge
    USER_REVIEW: 50, // 50-69 = user review
  },
} as const;

/**
 * Calculate Haversine distance between two GPS points.
 * Returns distance in meters.
 */
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Calculate multi-signal confidence score.
 *
 * Combines:
 * - GPS proximity (40% weight)
 * - Name similarity (35% weight)
 * - State/county match (25% weight)
 *
 * Returns total score and recommended action.
 */
export function calculateMultiSignalMatch(input: MultiSignalInput): MultiSignalResult {
  const { name1, name2, lat1, lng1, lat2, lng2, state1, state2, county1, county2 } = input;

  // Calculate name match
  const nameMatch = calculateNameMatch(name1, name2);

  // If blocked, return no match immediately
  if (nameMatch.blocked) {
    return {
      totalScore: 0,
      gpsScore: 0,
      nameScore: 0,
      locationScore: 0,
      nameMatch,
      action: 'no_match',
      tier: 'none',
    };
  }

  let gpsScore = 0;
  let distanceMeters: number | undefined;

  // GPS scoring
  if (lat1 != null && lng1 != null && lat2 != null && lng2 != null) {
    distanceMeters = haversineDistance(lat1, lng1, lat2, lng2);

    if (distanceMeters <= SIGNAL_WEIGHTS.GPS_TIERS.CLOSE.distance) {
      gpsScore = SIGNAL_WEIGHTS.GPS_TIERS.CLOSE.score;
    } else if (distanceMeters <= SIGNAL_WEIGHTS.GPS_TIERS.NEAR.distance) {
      gpsScore = SIGNAL_WEIGHTS.GPS_TIERS.NEAR.score;
    } else if (distanceMeters <= SIGNAL_WEIGHTS.GPS_TIERS.MEDIUM.distance) {
      gpsScore = SIGNAL_WEIGHTS.GPS_TIERS.MEDIUM.score;
    } else if (distanceMeters <= SIGNAL_WEIGHTS.GPS_TIERS.FAR.distance) {
      gpsScore = SIGNAL_WEIGHTS.GPS_TIERS.FAR.score;
    }
  }

  // Name scoring
  let nameScore = 0;
  const nameSim = nameMatch.score;

  if (nameSim >= SIGNAL_WEIGHTS.NAME_TIERS.EXACT.threshold) {
    nameScore = SIGNAL_WEIGHTS.NAME_TIERS.EXACT.score;
  } else if (nameSim >= SIGNAL_WEIGHTS.NAME_TIERS.HIGH.threshold) {
    nameScore = SIGNAL_WEIGHTS.NAME_TIERS.HIGH.score;
  } else if (nameSim >= SIGNAL_WEIGHTS.NAME_TIERS.MEDIUM.threshold) {
    nameScore = SIGNAL_WEIGHTS.NAME_TIERS.MEDIUM.score;
  } else if (nameSim >= SIGNAL_WEIGHTS.NAME_TIERS.LOW.threshold) {
    nameScore = SIGNAL_WEIGHTS.NAME_TIERS.LOW.score;
  }

  // Location scoring (state/county)
  let locationScore = 0;

  // Normalize states for comparison
  const normalizedState1 = state1?.toUpperCase().trim();
  const normalizedState2 = state2?.toUpperCase().trim();

  if (normalizedState1 && normalizedState2 && normalizedState1 === normalizedState2) {
    locationScore += 15; // Same state = 15 points
  }

  // County match adds additional 10 points
  const normalizedCounty1 = county1?.toLowerCase().trim();
  const normalizedCounty2 = county2?.toLowerCase().trim();

  if (normalizedCounty1 && normalizedCounty2 && normalizedCounty1 === normalizedCounty2) {
    locationScore += 10; // Same county = 10 points
  }

  // Total score
  const totalScore = gpsScore + nameScore + locationScore;

  // Determine action
  let action: 'auto_merge' | 'user_review' | 'no_match';
  let tier: 'high' | 'medium' | 'low' | 'none';

  // Override to user_review if name requires it
  if (nameMatch.requiresUserReview) {
    action = 'user_review';
    tier = 'medium';
  }
  // Override to user_review if generic name without close GPS
  else if (nameMatch.requiresGpsConfirm && (!distanceMeters || distanceMeters > 25)) {
    action = 'user_review';
    tier = 'medium';
  }
  // Normal threshold-based action
  else if (totalScore >= SIGNAL_WEIGHTS.ACTION_THRESHOLDS.AUTO_MERGE) {
    action = 'auto_merge';
    tier = 'high';
  } else if (totalScore >= SIGNAL_WEIGHTS.ACTION_THRESHOLDS.USER_REVIEW) {
    action = 'user_review';
    tier = 'medium';
  } else {
    action = 'no_match';
    tier = totalScore > 0 ? 'low' : 'none';
  }

  return {
    totalScore,
    gpsScore,
    nameScore,
    locationScore,
    distanceMeters,
    nameMatch,
    action,
    tier,
  };
}

export default {
  tokenize,
  tokenSetRatio,
  tokenSortRatio,
  combinedNameScore,
  isNameMatch,
  calculateNameMatch,
  hasBlockingConflict,
  checkBlockingConflict,
  isGenericName,
  hasUncertainty,
  isPlaceholder,
  getNameFlags,
  shouldExcludeFromSuggestions,
  calculateMultiSignalMatch,
  GENERIC_NAMES,
  BLOCKING_WORDS,
  SIGNAL_WEIGHTS,
  SUGGESTION_GENERIC_WORDS,
  SUGGESTION_REGION_WORDS,
};
