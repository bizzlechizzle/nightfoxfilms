/**
 * Application Constants
 *
 * Centralized configuration values to avoid magic numbers throughout the codebase.
 * Following LILBITS rule: Document configuration in one place.
 */

// Map Configuration
export const MAP_CONFIG = {
  DEFAULT_CENTER: { lat: 42.67917, lng: -76.87944 } as const,
  DEFAULT_ZOOM: 6,
  DETAIL_ZOOM: 10,
  MAX_ZOOM: 19,
  MIN_ZOOM: 0,
  CLUSTER_RADIUS: 60,
  CLUSTER_MAX_ZOOM: 16,
  CLUSTER_MIN_POINTS: 2,
  CLUSTER_EXPANSION_MAX_ZOOM: 17,
} as const;

// Tile Layer URLs
// P3c: Additional free/open-source map layers per v010steps.md
export const TILE_LAYERS = {
  SATELLITE: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  STREET: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  TOPO: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
  // ESRI Reference layers - designed for satellite overlay
  LABELS: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  ROADS: 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',
  // P3c: New layers
  CARTO_LIGHT: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  CARTO_DARK: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
} as const;

// UI Configuration
export const UI_CONFIG = {
  RECENT_LOCATIONS_LIMIT: 5,
  TOP_STATS_LIMIT: 5,
  RECENT_PAGES_LIMIT: 5,
  SEARCH_DEBOUNCE_MS: 300,
  TOAST_DURATION_MS: 3000,
  PAGE_SIZE_DEFAULT: 50,
  PAGE_SIZE_OPTIONS: [25, 50, 100, 200] as const,
} as const;

// Field Length Limits
export const FIELD_LIMITS = {
  LOCATION_NAME_MAX: 255,
  SHORT_NAME_LENGTH: 12,
  LOC12_LENGTH: 12,
  STATE_CODE_LENGTH: 2,
  ZIPCODE_REGEX: /^\d{5}(-\d{4})?$/,
} as const;

// GPS Configuration
export const GPS_CONFIG = {
  LAT_MIN: -90,
  LAT_MAX: 90,
  LNG_MIN: -180,
  LNG_MAX: 180,
  HIGH_ACCURACY_THRESHOLD_METERS: 10,
  GPS_MISMATCH_THRESHOLD_METERS: 100,
} as const;

// Kanye9: GPS-based zoom levels for map display
// Higher confidence = higher zoom (closer view)
export const GPS_ZOOM_LEVELS = {
  VERIFIED: 18,           // Building level - user confirmed location
  EXIF: 17,               // Street level - from camera GPS
  GEOCODED_ADDRESS: 17,   // Street level - forward geocoded from full address
  REVERSE_GEOCODE: 16,    // Block level - GPS existed, got address
  MANUAL: 15,             // Neighborhood - user typed coordinates
  STATE_CAPITAL: 8,       // State overview - fallback to capital
  US_CENTER: 4,           // Country view - no location data
} as const;

// Kanye9: Zoom levels by cascade geocoding tier
// More specific = higher zoom, less specific = wider view
export const GPS_GEOCODE_TIER_ZOOM = {
  1: 17,   // Tier 1: Full address - street level
  2: 13,   // Tier 2: City + State - city overview
  3: 12,   // Tier 3: Zipcode only - ZIP area
  4: 10,   // Tier 4: County + State - county view
  5: 8,    // Tier 5: State only - state overview
} as const;

// Database Configuration
export const DB_CONFIG = {
  PRAGMA_WAL: 'journal_mode = WAL',
  PRAGMA_FOREIGN_KEYS: 'foreign_keys = ON',
  RANDOM_LOCATION_LIMIT: 1,
} as const;

// File Organization
export const FILE_CONFIG = {
  HASH_ALGORITHM: 'sha256' as const,
  HASH_ENCODING: 'hex' as const,
  FOLDER_PATTERN: '[STATE]-[TYPE]' as const,
  LOCATION_FOLDER_PATTERN: '[SLOCNAM]-[LOC12]' as const,
} as const;

// Theme Colors - Braun/Rams Design System
// ADR: Gold accent removed entirely. Functional colors only.
export const THEME = {
  BACKGROUND: '#FAFAF8',       // cool paper
  SURFACE: '#FFFFFF',          // white
  FOREGROUND: '#1C1C1A',       // near-black
  // GPS functional colors: color = information hierarchy
  GPS_CONFIDENCE_COLORS: {
    verified: '#4A8C5E',       // muted sage green - map confirmed
    high: '#5A7A94',           // muted steel blue - EXIF <10m
    medium: '#C9A227',         // muted ochre - reverse geocoded
    low: '#B85C4A',            // muted terracotta - manual/estimate
    none: '#8A8A86',           // warm gray - no GPS
  },
} as const;

// Error Messages
export const ERROR_MESSAGES = {
  VALIDATION_FAILED: 'Validation error',
  LOCATION_NOT_FOUND: 'Location not found',
  DATABASE_ERROR: 'Database operation failed',
  FILE_NOT_FOUND: 'File not found',
  INVALID_GPS: 'Invalid GPS coordinates',
  DUPLICATE_LOCATION: 'Location already exists',
} as const;

// Success Messages
export const SUCCESS_MESSAGES = {
  LOCATION_CREATED: 'Location created successfully',
  LOCATION_UPDATED: 'Location updated successfully',
  LOCATION_DELETED: 'Location deleted successfully',
  SETTINGS_SAVED: 'Settings saved successfully',
} as const;

// Migration 38+: Duplicate Detection Configuration
// ADR: ADR-pin-conversion-duplicate-prevention.md
// Updated: 2025-12-11 with Token Set Ratio and multi-signal matching
export const DUPLICATE_CONFIG = {
  // === Cross-table matching (ref_map_points ↔ locs) ===
  GPS_RADIUS_METERS: 150,           // Same site threshold - locations within this distance are definite duplicates
  NAME_MATCH_RADIUS_METERS: 500,    // Max distance for name similarity matches - prevents matching by town name alone
  NAME_SIMILARITY_THRESHOLD: 0.80,  // 80% combined (JW + Token Set Ratio) - catches word reordering
  NEARBY_RADIUS_METERS: 400,        // ~0.25 miles - show "nearby" hint during creation
  GENERIC_NAME_GPS_RADIUS_METERS: 25, // Generic names (House, Church) require close GPS match
  TOKEN_SET_WEIGHT: 0.5,            // Weight for Token Set Ratio in combined score (0=JW only, 1=TSR only)
  AUTO_MERGE_CONFIDENCE: 70,        // Auto-merge threshold for multi-signal confidence (0-100)
  USER_REVIEW_CONFIDENCE: 50,       // User review threshold for multi-signal confidence (0-100)

  // === Within-table dedup (ref_map_points internal merging) ===
  // Wider thresholds because same location from different map sources may vary
  GPS_MERGE_THRESHOLD_METERS: 50,   // Same building tolerance for ref_map_points dedup (~150ft)
  NAME_DEDUP_THRESHOLD: 0.85,       // 85% similarity for name-based dedup within ref_map_points
  NAME_DEDUP_GPS_RADIUS_METERS: 500, // Max GPS distance for name-based dedup (same general area)
} as const;

// Generic names that require GPS confirmation for duplicate detection
// These shouldn't match on name alone - too many "House" or "Church" entries
export const GENERIC_LOCATION_NAMES = new Set([
  'house', 'church', 'school', 'factory', 'industrial', 'industry',
  'building', 'farm', 'barn', 'mill', 'warehouse', 'store', 'shop',
  'hotel', 'motel', 'hospital', 'office', 'station', 'tower', 'plant',
  'center', 'site', 'place', 'location', 'point', 'cars', 'trains', 'trucks',
]) as ReadonlySet<string>;

// Blocking words that indicate different places (North vs South, Building A vs B)
export const BLOCKING_WORDS_CONFIG = {
  directions: ['north', 'south', 'east', 'west', 'upper', 'lower', 'inner', 'outer'],
  temporal: ['old', 'new', 'former', 'current', 'original', 'modern', 'historic'],
  numbered: ['first', 'second', 'third', 'fourth', 'fifth', '1st', '2nd', '3rd', '4th', '5th'],
} as const;
