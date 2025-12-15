/**
 * Shared constants for location forms
 * Used by: ImportModal, ImportForm, LocationEditForm
 */

// Documentation level options per spec
export const DOCUMENTATION_OPTIONS = [
  'Interior + Exterior',
  'Exterior Only',
  'Perimeter Only',
  'Drive-By',
  'No Visit / Keyboard Scout',
  'Drone Only',
] as const;

// P0: Access options - consolidated from condition/status per v010steps.md
export const ACCESS_OPTIONS = [
  'Abandoned',
  'Demolished',
  'Active',
  'Partially Active',
  'Future Classic',
  'Vacant',
  'Renovated',
  'Unknown',
] as const;

// GPS source options per spec (must match core GpsSource type)
export const GPS_SOURCE_OPTIONS = [
  { value: 'manual_entry', label: 'Manual Entry' },
  { value: 'user_map_click', label: 'Map Click' },
  { value: 'photo_exif', label: 'Photo EXIF' },
  { value: 'geocoded_address', label: 'Address Geocoded' },
] as const;

// Type definitions
export type DocumentationOption = typeof DOCUMENTATION_OPTIONS[number];
export type AccessOption = typeof ACCESS_OPTIONS[number];
export type GpsSourceOption = typeof GPS_SOURCE_OPTIONS[number];
