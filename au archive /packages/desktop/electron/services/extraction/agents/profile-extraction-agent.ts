/**
 * Profile Extraction Agent
 *
 * Extracts people and organization profiles from documents using:
 * 1. spaCy preprocessing for candidate identification
 * 2. LLM extraction for detailed profile generation
 * 3. Normalization and deduplication
 * 4. Database storage
 *
 * @version 1.0
 */

import type { Database as SqliteDatabase } from 'better-sqlite3';
import { randomUUID } from 'crypto';

import type {
  PersonProfile,
  CompanyProfile,
  PersonProfileInput,
  CompanyProfileInput,
  PersonRole,
  OrganizationType,
  CompanyRelationship,
  ProfileStatus,
} from '../profile-types';

import type { PreprocessingResult } from '../preprocessing-types';

import {
  getPrompt,
  getOllamaPrompt,
  buildProfileExtractionPrompt,
} from './versioned-prompts';

import { getPreprocessingService, normalizeName, normalizeOrgName } from '../preprocessing-service';
import { parseStructuredResponse } from './prompt-templates';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Raw profile extraction from LLM
 */
interface RawPersonProfile {
  fullName: string;
  normalizedName: string;
  role: string;
  dateStart?: string | null;
  dateEnd?: string | null;
  keyFacts?: string[];
  aliases?: string[];
  context?: string;
  confidence: number;
}

interface RawOrgProfile {
  fullName: string;
  normalizedName: string;
  orgType: string;
  industry?: string | null;
  relationship?: string;
  dateStart?: string | null;
  dateEnd?: string | null;
  keyFacts?: string[];
  aliases?: string[];
  context?: string;
  confidence: number;
}

interface ProfileExtractionResult {
  people: RawPersonProfile[];
  organizations: RawOrgProfile[];
  extractionNotes?: string;
}

/**
 * Configuration for profile extraction
 */
export interface ProfileExtractionConfig {
  /** Minimum confidence for accepting profiles */
  minConfidence: number;
  /** Use Ollama-optimized prompts */
  useOllamaPrompt: boolean;
  /** Provider ID for LLM calls */
  providerId?: string;
  /** Prompt version to use */
  promptVersion?: string;
  /** Enable cross-location matching */
  enableCrossLocationMatching: boolean;
}

const DEFAULT_CONFIG: ProfileExtractionConfig = {
  minConfidence: 0.5,
  useOllamaPrompt: false,
  enableCrossLocationMatching: true,
};

// =============================================================================
// PROFILE EXTRACTION AGENT
// =============================================================================

export class ProfileExtractionAgent {
  private db: SqliteDatabase;
  private config: ProfileExtractionConfig;
  private llmCaller: (systemPrompt: string, userPrompt: string) => Promise<string>;

  constructor(
    db: SqliteDatabase,
    llmCaller: (systemPrompt: string, userPrompt: string) => Promise<string>,
    config?: Partial<ProfileExtractionConfig>
  ) {
    this.db = db;
    this.llmCaller = llmCaller;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Extract profiles from text
   *
   * @param text - Raw document text
   * @param locid - Location ID to associate profiles with
   * @param sourceRef - Source reference (web_source ID)
   * @returns Extracted and stored profiles
   */
  async extractProfiles(
    text: string,
    locid: string,
    sourceRef: string
  ): Promise<{
    people: PersonProfile[];
    organizations: CompanyProfile[];
    warnings: string[];
  }> {
    const warnings: string[] = [];

    try {
      // Step 1: Preprocess text
      const preprocessingService = getPreprocessingService();
      let preprocessing: PreprocessingResult;

      if (await preprocessingService.isAvailable()) {
        preprocessing = await preprocessingService.preprocess(text);
      } else {
        warnings.push('spaCy preprocessing unavailable, using raw text');
        preprocessing = this.createMinimalPreprocessing(text);
      }

      // Step 2: Format profile candidates for prompt
      const { people: peopleStr, organizations: orgsStr } =
        preprocessingService.formatForProfileExtraction(preprocessing);

      // Step 3: Build prompt
      const prompt = this.config.useOllamaPrompt
        ? getOllamaPrompt('profile_extraction')
        : getPrompt('profile_extraction', this.config.promptVersion);

      const built = buildProfileExtractionPrompt({
        text: text.substring(0, 10000), // Limit text length
        people_candidates: peopleStr,
        organization_candidates: orgsStr,
      }, this.config.promptVersion);

      // Step 4: Call LLM
      const response = await this.llmCaller(built.systemPrompt, built.userPrompt);

      // Step 5: Parse response
      const parsed = this.parseProfileResponse(response);

      if (!parsed) {
        warnings.push('Failed to parse LLM response');
        return { people: [], organizations: [], warnings };
      }

      // Step 6: Store profiles
      const storedPeople = await this.storePersonProfiles(
        parsed.people,
        locid,
        sourceRef,
        built.version
      );

      const storedOrgs = await this.storeCompanyProfiles(
        parsed.organizations,
        locid,
        sourceRef,
        built.version
      );

      // Step 7: Cross-location matching (if enabled)
      if (this.config.enableCrossLocationMatching) {
        await this.findCrossLocationMatches(storedPeople, storedOrgs);
      }

      return {
        people: storedPeople,
        organizations: storedOrgs,
        warnings,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      warnings.push(`Profile extraction failed: ${errorMsg}`);
      return { people: [], organizations: [], warnings };
    }
  }

  /**
   * Parse LLM response into profile structures
   */
  private parseProfileResponse(response: string): ProfileExtractionResult | null {
    try {
      // Clean response
      let json = response.trim();

      // Remove markdown code blocks
      const codeBlockMatch = json.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        json = codeBlockMatch[1].trim();
      }

      // Find JSON boundaries
      const firstBrace = json.indexOf('{');
      const lastBrace = json.lastIndexOf('}');

      if (firstBrace === -1 || lastBrace === -1) {
        return null;
      }

      json = json.substring(firstBrace, lastBrace + 1);

      const parsed = JSON.parse(json) as {
        people?: RawPersonProfile[];
        organizations?: RawOrgProfile[];
        extractionNotes?: string;
      };

      return {
        people: parsed.people || [],
        organizations: parsed.organizations || [],
        extractionNotes: parsed.extractionNotes,
      };
    } catch {
      return null;
    }
  }

  /**
   * Store person profiles in database
   */
  private async storePersonProfiles(
    profiles: RawPersonProfile[],
    locid: string,
    sourceRef: string,
    promptVersion: string
  ): Promise<PersonProfile[]> {
    const stored: PersonProfile[] = [];

    for (const raw of profiles) {
      if (raw.confidence < this.config.minConfidence) {
        continue;
      }

      // Check for existing profile with same normalized name
      const existing = this.findExistingPersonProfile(locid, raw.normalizedName);

      if (existing) {
        // Update existing profile
        const updated = this.mergePersonProfile(existing, raw, sourceRef);
        stored.push(updated);
      } else {
        // Create new profile
        const profile = this.createPersonProfile(raw, locid, sourceRef);
        stored.push(profile);
      }
    }

    return stored;
  }

  /**
   * Store company profiles in database
   */
  private async storeCompanyProfiles(
    profiles: RawOrgProfile[],
    locid: string,
    sourceRef: string,
    promptVersion: string
  ): Promise<CompanyProfile[]> {
    const stored: CompanyProfile[] = [];

    for (const raw of profiles) {
      if (raw.confidence < this.config.minConfidence) {
        continue;
      }

      // Check for existing profile
      const existing = this.findExistingCompanyProfile(locid, raw.normalizedName);

      if (existing) {
        // Update existing profile
        const updated = this.mergeCompanyProfile(existing, raw, sourceRef);
        stored.push(updated);
      } else {
        // Create new profile
        const profile = this.createCompanyProfile(raw, locid, sourceRef);
        stored.push(profile);
      }
    }

    return stored;
  }

  /**
   * Find existing person profile by normalized name
   */
  private findExistingPersonProfile(
    locid: string,
    normalizedName: string
  ): PersonProfile | null {
    try {
      const row = this.db.prepare(`
        SELECT * FROM people_profiles
        WHERE locid = ? AND normalized_name = ?
        LIMIT 1
      `).get(locid, normalizedName) as Record<string, unknown> | undefined;

      if (!row) return null;

      return this.rowToPersonProfile(row);
    } catch {
      return null;
    }
  }

  /**
   * Find existing company profile by normalized name
   */
  private findExistingCompanyProfile(
    locid: string,
    normalizedName: string
  ): CompanyProfile | null {
    try {
      const row = this.db.prepare(`
        SELECT * FROM company_profiles
        WHERE locid = ? AND normalized_name = ?
        LIMIT 1
      `).get(locid, normalizedName) as Record<string, unknown> | undefined;

      if (!row) return null;

      return this.rowToCompanyProfile(row);
    } catch {
      return null;
    }
  }

  /**
   * Create a new person profile
   */
  private createPersonProfile(
    raw: RawPersonProfile,
    locid: string,
    sourceRef: string
  ): PersonProfile {
    const profile_id = randomUUID();
    const now = new Date().toISOString();

    const profile: PersonProfile = {
      profile_id,
      locid,
      full_name: raw.fullName,
      normalized_name: normalizeName(raw.normalizedName || raw.fullName),
      role: this.normalizePersonRole(raw.role),
      date_start: raw.dateStart || undefined,
      date_end: raw.dateEnd || undefined,
      key_facts: raw.keyFacts || [],
      source_refs: [sourceRef],
      aliases: raw.aliases || [],
      confidence: raw.confidence,
      status: 'pending' as ProfileStatus,
      created_at: now,
    };

    // Insert into database
    this.db.prepare(`
      INSERT INTO people_profiles (
        profile_id, locid, full_name, normalized_name, role,
        date_start, date_end, key_facts, source_refs, aliases,
        confidence, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      profile.profile_id,
      profile.locid,
      profile.full_name,
      profile.normalized_name,
      profile.role,
      profile.date_start || null,
      profile.date_end || null,
      JSON.stringify(profile.key_facts),
      JSON.stringify(profile.source_refs),
      JSON.stringify(profile.aliases),
      profile.confidence,
      profile.status,
      profile.created_at
    );

    return profile;
  }

  /**
   * Create a new company profile
   */
  private createCompanyProfile(
    raw: RawOrgProfile,
    locid: string,
    sourceRef: string
  ): CompanyProfile {
    const profile_id = randomUUID();
    const now = new Date().toISOString();

    const profile: CompanyProfile = {
      profile_id,
      locid,
      full_name: raw.fullName,
      normalized_name: normalizeOrgName(raw.normalizedName || raw.fullName),
      org_type: this.normalizeOrgType(raw.orgType),
      industry: raw.industry || undefined,
      relationship: this.normalizeRelationship(raw.relationship),
      date_start: raw.dateStart || undefined,
      date_end: raw.dateEnd || undefined,
      key_facts: raw.keyFacts || [],
      source_refs: [sourceRef],
      aliases: raw.aliases || [],
      confidence: raw.confidence,
      status: 'pending' as ProfileStatus,
      created_at: now,
    };

    // Insert into database
    this.db.prepare(`
      INSERT INTO company_profiles (
        profile_id, locid, full_name, normalized_name, org_type, industry,
        relationship, date_start, date_end, key_facts, source_refs, aliases,
        confidence, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      profile.profile_id,
      profile.locid,
      profile.full_name,
      profile.normalized_name,
      profile.org_type,
      profile.industry || null,
      profile.relationship,
      profile.date_start || null,
      profile.date_end || null,
      JSON.stringify(profile.key_facts),
      JSON.stringify(profile.source_refs),
      JSON.stringify(profile.aliases),
      profile.confidence,
      profile.status,
      profile.created_at
    );

    return profile;
  }

  /**
   * Merge new data into existing person profile
   */
  private mergePersonProfile(
    existing: PersonProfile,
    raw: RawPersonProfile,
    newSourceRef: string
  ): PersonProfile {
    // Merge source refs
    const sourceRefs = [...new Set([...existing.source_refs, newSourceRef])];

    // Merge aliases
    const aliases = [...new Set([...existing.aliases, ...(raw.aliases || [])])];

    // Merge key facts (keep unique)
    const keyFacts = [...new Set([...existing.key_facts, ...(raw.keyFacts || [])])].slice(0, 5);

    // Update confidence (take higher)
    const confidence = Math.max(existing.confidence, raw.confidence);

    // Update role if unknown and new data has role
    const role =
      existing.role === 'unknown' && raw.role !== 'unknown'
        ? this.normalizePersonRole(raw.role)
        : existing.role;

    // Update dates if missing
    const date_start = existing.date_start || raw.dateStart || undefined;
    const date_end = existing.date_end || raw.dateEnd || undefined;

    const now = new Date().toISOString();

    // Update database
    this.db.prepare(`
      UPDATE people_profiles SET
        source_refs = ?,
        aliases = ?,
        key_facts = ?,
        confidence = ?,
        role = ?,
        date_start = ?,
        date_end = ?,
        updated_at = ?
      WHERE profile_id = ?
    `).run(
      JSON.stringify(sourceRefs),
      JSON.stringify(aliases),
      JSON.stringify(keyFacts),
      confidence,
      role,
      date_start || null,
      date_end || null,
      now,
      existing.profile_id
    );

    return {
      ...existing,
      source_refs: sourceRefs,
      aliases,
      key_facts: keyFacts,
      confidence,
      role,
      date_start,
      date_end,
      updated_at: now,
    };
  }

  /**
   * Merge new data into existing company profile
   */
  private mergeCompanyProfile(
    existing: CompanyProfile,
    raw: RawOrgProfile,
    newSourceRef: string
  ): CompanyProfile {
    // Merge source refs
    const sourceRefs = [...new Set([...existing.source_refs, newSourceRef])];

    // Merge aliases
    const aliases = [...new Set([...existing.aliases, ...(raw.aliases || [])])];

    // Merge key facts
    const keyFacts = [...new Set([...existing.key_facts, ...(raw.keyFacts || [])])].slice(0, 5);

    // Update confidence
    const confidence = Math.max(existing.confidence, raw.confidence);

    // Update type if unknown
    const org_type =
      existing.org_type === 'unknown' && raw.orgType !== 'unknown'
        ? this.normalizeOrgType(raw.orgType)
        : existing.org_type;

    // Update relationship if unknown
    const relationship =
      existing.relationship === 'unknown' && raw.relationship !== 'unknown'
        ? this.normalizeRelationship(raw.relationship)
        : existing.relationship;

    // Update dates if missing
    const date_start = existing.date_start || raw.dateStart || undefined;
    const date_end = existing.date_end || raw.dateEnd || undefined;

    // Update industry if missing
    const industry = existing.industry || raw.industry || undefined;

    const now = new Date().toISOString();

    // Update database
    this.db.prepare(`
      UPDATE company_profiles SET
        source_refs = ?,
        aliases = ?,
        key_facts = ?,
        confidence = ?,
        org_type = ?,
        relationship = ?,
        industry = ?,
        date_start = ?,
        date_end = ?,
        updated_at = ?
      WHERE profile_id = ?
    `).run(
      JSON.stringify(sourceRefs),
      JSON.stringify(aliases),
      JSON.stringify(keyFacts),
      confidence,
      org_type,
      relationship,
      industry || null,
      date_start || null,
      date_end || null,
      now,
      existing.profile_id
    );

    return {
      ...existing,
      source_refs: sourceRefs,
      aliases,
      key_facts: keyFacts,
      confidence,
      org_type,
      relationship,
      industry,
      date_start,
      date_end,
      updated_at: now,
    };
  }

  /**
   * Find cross-location matches for profiles
   */
  private async findCrossLocationMatches(
    people: PersonProfile[],
    organizations: CompanyProfile[]
  ): Promise<void> {
    // Find matching people across locations
    for (const person of people) {
      const matches = this.db.prepare(`
        SELECT profile_id, locid, full_name, confidence
        FROM people_profiles
        WHERE normalized_name = ? AND locid != ?
      `).all(person.normalized_name, person.locid) as Array<{
        profile_id: string;
        locid: string;
        full_name: string;
        confidence: number;
      }>;

      if (matches.length > 0) {
        // Store cross-location references
        // This could be expanded to store in a separate table
        console.log(
          `[ProfileAgent] Found ${matches.length} cross-location matches for ${person.full_name}`
        );
      }
    }

    // Find matching organizations
    for (const org of organizations) {
      const matches = this.db.prepare(`
        SELECT profile_id, locid, full_name, confidence
        FROM company_profiles
        WHERE normalized_name = ? AND locid != ?
      `).all(org.normalized_name, org.locid) as Array<{
        profile_id: string;
        locid: string;
        full_name: string;
        confidence: number;
      }>;

      if (matches.length > 0) {
        console.log(
          `[ProfileAgent] Found ${matches.length} cross-location matches for ${org.full_name}`
        );
      }
    }
  }

  /**
   * Normalize person role to valid enum
   */
  private normalizePersonRole(role: string): PersonRole {
    const validRoles: PersonRole[] = [
      'owner', 'architect', 'developer', 'employee', 'founder',
      'visitor', 'photographer', 'historian', 'unknown'
    ];

    const normalized = role?.toLowerCase().trim() || 'unknown';

    return validRoles.includes(normalized as PersonRole)
      ? (normalized as PersonRole)
      : 'unknown';
  }

  /**
   * Normalize organization type to valid enum
   */
  private normalizeOrgType(type: string): OrganizationType {
    const validTypes: OrganizationType[] = [
      'company', 'government', 'school', 'hospital',
      'church', 'nonprofit', 'military', 'unknown'
    ];

    const normalized = type?.toLowerCase().trim() || 'unknown';

    return validTypes.includes(normalized as OrganizationType)
      ? (normalized as OrganizationType)
      : 'unknown';
  }

  /**
   * Normalize company relationship to valid enum
   */
  private normalizeRelationship(relationship: string | undefined): CompanyRelationship {
    const validRelationships: CompanyRelationship[] = [
      'owner', 'operator', 'tenant', 'builder', 'demolisher', 'unknown'
    ];

    const normalized = relationship?.toLowerCase().trim() || 'unknown';

    return validRelationships.includes(normalized as CompanyRelationship)
      ? (normalized as CompanyRelationship)
      : 'unknown';
  }

  /**
   * Convert database row to PersonProfile
   */
  private rowToPersonProfile(row: Record<string, unknown>): PersonProfile {
    return {
      profile_id: row.profile_id as string,
      locid: row.locid as string,
      full_name: row.full_name as string,
      normalized_name: row.normalized_name as string,
      role: row.role as PersonRole,
      date_start: row.date_start as string | undefined,
      date_end: row.date_end as string | undefined,
      key_facts: JSON.parse((row.key_facts as string) || '[]'),
      photo_hash: row.photo_hash as string | undefined,
      social_links: row.social_links ? JSON.parse(row.social_links as string) : undefined,
      source_refs: JSON.parse((row.source_refs as string) || '[]'),
      aliases: JSON.parse((row.aliases as string) || '[]'),
      confidence: row.confidence as number,
      status: row.status as ProfileStatus,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string | undefined,
    };
  }

  /**
   * Convert database row to CompanyProfile
   */
  private rowToCompanyProfile(row: Record<string, unknown>): CompanyProfile {
    return {
      profile_id: row.profile_id as string,
      locid: row.locid as string,
      full_name: row.full_name as string,
      normalized_name: row.normalized_name as string,
      org_type: row.org_type as OrganizationType,
      industry: row.industry as string | undefined,
      relationship: row.relationship as CompanyRelationship,
      date_start: row.date_start as string | undefined,
      date_end: row.date_end as string | undefined,
      key_facts: JSON.parse((row.key_facts as string) || '[]'),
      logo_hash: row.logo_hash as string | undefined,
      logo_source: row.logo_source as string | undefined,
      source_refs: JSON.parse((row.source_refs as string) || '[]'),
      aliases: JSON.parse((row.aliases as string) || '[]'),
      confidence: row.confidence as number,
      status: row.status as ProfileStatus,
      created_at: row.created_at as string,
      updated_at: row.updated_at as string | undefined,
    };
  }

  /**
   * Create minimal preprocessing result when spaCy is unavailable
   */
  private createMinimalPreprocessing(text: string): PreprocessingResult {
    return {
      document_stats: {
        total_sentences: 0,
        timeline_relevant: 0,
        profile_relevant: 0,
        total_people: 0,
        total_organizations: 0,
      },
      sentences: [],
      timeline_candidates: [],
      profile_candidates: {
        people: [],
        organizations: [],
      },
      llm_context: text.substring(0, 5000),
      article_date: null,
      processing_time_ms: 0,
    };
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a profile extraction agent
 */
export function createProfileExtractionAgent(
  db: SqliteDatabase,
  llmCaller: (systemPrompt: string, userPrompt: string) => Promise<string>,
  config?: Partial<ProfileExtractionConfig>
): ProfileExtractionAgent {
  return new ProfileExtractionAgent(db, llmCaller, config);
}
