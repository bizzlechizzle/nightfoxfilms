/**
 * Profile Types
 *
 * Types for people and company profiles extracted from documents.
 * These represent the persistent profile records stored in the database.
 *
 * @version 1.0
 */

// =============================================================================
// ENUMS AND CONSTANTS
// =============================================================================

/**
 * Person role in relation to the location
 */
export type PersonRole =
  | 'owner'
  | 'architect'
  | 'developer'
  | 'employee'
  | 'founder'
  | 'visitor'
  | 'photographer'
  | 'historian'
  | 'unknown';

/**
 * Organization type classification
 */
export type OrganizationType =
  | 'company'
  | 'government'
  | 'school'
  | 'hospital'
  | 'church'
  | 'nonprofit'
  | 'military'
  | 'unknown';

/**
 * Company's relationship to the location
 */
export type CompanyRelationship =
  | 'owner'
  | 'operator'
  | 'tenant'
  | 'builder'
  | 'demolisher'
  | 'unknown';

/**
 * Profile review status
 */
export type ProfileStatus = 'pending' | 'approved' | 'rejected' | 'merged';

// =============================================================================
// SOCIAL LINKS
// =============================================================================

/**
 * Social/research links for a person
 */
export interface SocialLinks {
  /** Find A Grave memorial link */
  findagrave?: string;
  /** Newspapers.com article link */
  newspapers_com?: string;
  /** Ancestry.com profile link */
  ancestry?: string;
  /** Wikipedia page link */
  wikipedia?: string;
  /** LinkedIn profile (for recent people) */
  linkedin?: string;
  /** Other custom links */
  other?: Record<string, string>;
}

// =============================================================================
// PERSON PROFILE
// =============================================================================

/**
 * A person profile extracted from documents
 */
export interface PersonProfile {
  /** Unique profile ID */
  profile_id: string;
  /** Associated location ID */
  locid: string;
  /** Full name as displayed */
  full_name: string;
  /** Normalized name for deduplication */
  normalized_name: string;
  /** Primary role */
  role: PersonRole;
  /** Start of involvement (year or date) */
  date_start?: string;
  /** End of involvement (year or date) */
  date_end?: string;
  /** Key facts about this person (max 5) */
  key_facts: string[];
  /** Profile photo hash (link to imgs table) */
  photo_hash?: string;
  /** External links */
  social_links?: SocialLinks;
  /** Source references (web_source IDs) */
  source_refs: string[];
  /** Alternate names/aliases */
  aliases: string[];
  /** Confidence score 0-1 */
  confidence: number;
  /** Review status */
  status: ProfileStatus;
  /** When created */
  created_at: string;
  /** When last updated */
  updated_at?: string;
}

/**
 * Input for creating a person profile
 */
export interface PersonProfileInput {
  locid: string;
  full_name: string;
  role?: PersonRole;
  date_start?: string;
  date_end?: string;
  key_facts?: string[];
  photo_hash?: string;
  social_links?: SocialLinks;
  source_refs?: string[];
  aliases?: string[];
  confidence?: number;
}

// =============================================================================
// COMPANY PROFILE
// =============================================================================

/**
 * A company/organization profile extracted from documents
 */
export interface CompanyProfile {
  /** Unique profile ID */
  profile_id: string;
  /** Associated location ID */
  locid: string;
  /** Full organization name */
  full_name: string;
  /** Normalized name for deduplication */
  normalized_name: string;
  /** Organization type */
  org_type: OrganizationType;
  /** Industry/sector */
  industry?: string;
  /** Relationship to location */
  relationship: CompanyRelationship;
  /** Start of operation (year or date) */
  date_start?: string;
  /** End of operation (year or date) */
  date_end?: string;
  /** Key facts about this organization (max 5) */
  key_facts: string[];
  /** Logo hash (link to imgs table) */
  logo_hash?: string;
  /** Where the logo was found */
  logo_source?: string;
  /** Source references (web_source IDs) */
  source_refs: string[];
  /** Alternate names/aliases */
  aliases: string[];
  /** Confidence score 0-1 */
  confidence: number;
  /** Review status */
  status: ProfileStatus;
  /** When created */
  created_at: string;
  /** When last updated */
  updated_at?: string;
}

/**
 * Input for creating a company profile
 */
export interface CompanyProfileInput {
  locid: string;
  full_name: string;
  org_type?: OrganizationType;
  industry?: string;
  relationship?: CompanyRelationship;
  date_start?: string;
  date_end?: string;
  key_facts?: string[];
  logo_hash?: string;
  logo_source?: string;
  source_refs?: string[];
  aliases?: string[];
  confidence?: number;
}

// =============================================================================
// PROFILE OPERATIONS
// =============================================================================

/**
 * Result of a profile merge operation
 */
export interface ProfileMergeResult {
  /** The surviving profile ID */
  merged_into: string;
  /** Profile IDs that were merged */
  merged_from: string[];
  /** Combined aliases */
  combined_aliases: string[];
  /** Combined source refs */
  combined_sources: string[];
}

/**
 * Profile search/filter options
 */
export interface ProfileSearchOptions {
  /** Location ID to filter by */
  locid?: string;
  /** Status filter */
  status?: ProfileStatus | ProfileStatus[];
  /** Minimum confidence */
  minConfidence?: number;
  /** Text search in name/aliases */
  search?: string;
  /** Limit results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

// =============================================================================
// CROSS-LOCATION LINKING
// =============================================================================

/**
 * A cross-location entity reference
 */
export interface CrossLocationRef {
  /** The other location ID */
  locid: string;
  /** The profile ID in that location */
  profile_id: string;
  /** Confidence of the match */
  confidence: number;
  /** How the match was determined */
  match_method: 'normalized_name' | 'alias' | 'manual';
}

/**
 * Profile with cross-location references
 */
export interface ProfileWithCrossRefs {
  profile: PersonProfile | CompanyProfile;
  cross_refs: CrossLocationRef[];
}
