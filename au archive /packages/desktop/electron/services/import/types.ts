/**
 * Import System v2.0 - Shared Types
 *
 * Centralized type definitions to ensure consistency across
 * scanner, hasher, copier, validator, finalizer, and orchestrator.
 *
 * @module services/import/types
 */

/**
 * Location context for import operations
 *
 * ADR-046: Simplified folder structure
 * - New format: [archive]/locations/[STATE]/[LOCID]/data/org-[type]/
 * - Sub-location: [archive]/locations/[STATE]/[LOCID]/data/sloc-[SUBID]/org-[type]/
 *
 * Contains all information needed to:
 * - Build archive folder paths
 * - Assign media to correct location/sub-location
 * - Track import provenance
 *
 * Single source of truth - used by copier, finalizer, orchestrator
 */
export interface LocationInfo {
  /** BLAKE3 16-char hex ID of the host location (ADR-046) */
  locid: string;

  /** Two-letter state code (e.g., "NY") for folder hierarchy */
  address_state: string | null;

  /**
   * Sub-location BLAKE3 16-char hex ID (null if importing to host location)
   * When provided, media records will have this subid set
   * Creates folder: sloc-[SUBID]/
   */
  subid: string | null;
}

/**
 * Media type classification
 */
export type MediaType = 'image' | 'video' | 'document' | 'map' | 'unknown';

/**
 * Base file info from scanner
 */
export interface BaseFileInfo {
  /** Unique ID for tracking through pipeline */
  id: string;

  /** Original filename */
  filename: string;

  /** Original full path */
  originalPath: string;

  /** File extension (with dot) */
  extension: string;

  /** File size in bytes */
  size: number;

  /** Detected media type */
  mediaType: MediaType;
}
