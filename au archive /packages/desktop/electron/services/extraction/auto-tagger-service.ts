/**
 * Auto-Tagger Service
 *
 * Automatically detects location type and era from extracted text.
 *
 * Per extraction-pipeline-final.md:
 * - Location Type: ONE tag required (golf-course, factory, hospital, etc.)
 * - Era: ONE tag based on build year (pre-1900, 1900-1930, etc.)
 * - Status: ONE tag for current state (abandoned, demolished, etc.)
 *
 * @version 1.0
 */

import type { Database as SqliteDatabase } from 'better-sqlite3';

// =============================================================================
// TYPES
// =============================================================================

export type LocationType =
  | 'golf-course'
  | 'factory'
  | 'hospital'
  | 'school'
  | 'church'
  | 'theater'
  | 'hotel'
  | 'mall'
  | 'prison'
  | 'asylum'
  | 'military'
  | 'resort'
  | 'power-plant'
  | 'warehouse'
  | 'office'
  | 'residential'
  | 'farm'
  | 'mine'
  | 'other';

export type Era =
  | 'pre-1900'
  | '1900-1930'
  | '1930-1960'
  | '1960-1990'
  | '1990-present';

export type LocationStatus =
  | 'abandoned'
  | 'demolished'
  | 'renovated'
  | 'active'
  | 'unknown';

export interface TagResult {
  locationType: LocationType | null;
  era: Era | null;
  status: LocationStatus | null;
  confidence: {
    locationType: number;
    era: number;
    status: number;
  };
}

// =============================================================================
// KEYWORD DICTIONARIES
// =============================================================================

const LOCATION_TYPE_KEYWORDS: Record<LocationType, string[]> = {
  'golf-course': [
    'golf', 'country club', 'clubhouse', 'fairway', 'tee box', 'putting green',
    'pro shop', '18-hole', '9-hole', 'par 3', 'par 4', 'par 5', 'driving range',
    'caddy', 'links'
  ],
  'factory': [
    'factory', 'manufacturing', 'industrial', 'plant', 'mill', 'foundry',
    'assembly', 'production', 'warehouse', 'works', 'machinery', 'textile',
    'steel', 'auto plant', 'processing'
  ],
  'hospital': [
    'hospital', 'medical center', 'clinic', 'infirmary', 'sanitarium',
    'healthcare', 'surgical', 'patient', 'ward', 'emergency room', 'icu',
    'nursing', 'medical', 'doctors'
  ],
  'school': [
    'school', 'academy', 'college', 'university', 'campus', 'classroom',
    'gymnasium', 'auditorium', 'cafeteria', 'library', 'dormitory', 'student',
    'education', 'elementary', 'high school', 'junior high', 'middle school'
  ],
  'church': [
    'church', 'cathedral', 'chapel', 'sanctuary', 'parish', 'congregation',
    'steeple', 'altar', 'pews', 'diocese', 'monastery', 'convent', 'temple',
    'synagogue', 'mosque', 'religious'
  ],
  'theater': [
    'theater', 'theatre', 'cinema', 'movie house', 'playhouse', 'stage',
    'auditorium', 'orchestra pit', 'balcony', 'marquee', 'projection',
    'vaudeville', 'opera house'
  ],
  'hotel': [
    'hotel', 'motel', 'inn', 'lodge', 'resort', 'guest rooms', 'lobby',
    'concierge', 'bellhop', 'vacancy', 'rooms', 'suite', 'hospitality'
  ],
  'mall': [
    'mall', 'shopping center', 'plaza', 'retail', 'stores', 'department store',
    'food court', 'anchor store', 'boutique', 'shopping'
  ],
  'prison': [
    'prison', 'jail', 'penitentiary', 'correctional', 'detention', 'inmate',
    'cell block', 'warden', 'guard tower', 'incarceration', 'reformatory'
  ],
  'asylum': [
    'asylum', 'mental hospital', 'psychiatric', 'institution', 'sanitarium',
    'insane', 'mental health', 'state hospital', 'ward', 'kirkbride'
  ],
  'military': [
    'military', 'army', 'navy', 'air force', 'barracks', 'base', 'fort',
    'arsenal', 'armory', 'bunker', 'missile', 'radar', 'command', 'defense'
  ],
  'resort': [
    'resort', 'spa', 'vacation', 'recreation', 'pool', 'beach', 'ski',
    'retreat', 'getaway', 'leisure', 'amusement'
  ],
  'power-plant': [
    'power plant', 'power station', 'generating', 'turbine', 'reactor',
    'nuclear', 'coal', 'hydroelectric', 'dam', 'electrical', 'utility',
    'cooling tower'
  ],
  'warehouse': [
    'warehouse', 'storage', 'distribution', 'depot', 'freight', 'shipping',
    'loading dock', 'inventory', 'stockpile'
  ],
  'office': [
    'office', 'corporate', 'headquarters', 'business', 'administration',
    'executive', 'cubicle', 'conference room'
  ],
  'residential': [
    'house', 'mansion', 'estate', 'residence', 'home', 'apartment', 'condo',
    'dwelling', 'domestic', 'family'
  ],
  'farm': [
    'farm', 'ranch', 'barn', 'silo', 'crops', 'livestock', 'agriculture',
    'dairy', 'orchard', 'vineyard', 'plantation'
  ],
  'mine': [
    'mine', 'mining', 'quarry', 'shaft', 'ore', 'coal mine', 'pit',
    'excavation', 'mineral', 'extraction'
  ],
  'other': []
};

const STATUS_KEYWORDS: Record<LocationStatus, string[]> = {
  'abandoned': [
    'abandoned', 'vacant', 'empty', 'deserted', 'forsaken', 'derelict',
    'unused', 'closed', 'shut down', 'shuttered', 'left behind', 'decay',
    'deteriorating', 'crumbling', 'rotting', 'overgrown'
  ],
  'demolished': [
    'demolished', 'torn down', 'razed', 'destroyed', 'leveled', 'cleared',
    'wrecked', 'bulldozed', 'imploded', 'no longer exists', 'site of',
    'formerly stood'
  ],
  'renovated': [
    'renovated', 'restored', 'refurbished', 'converted', 'repurposed',
    'redeveloped', 'rehabilitation', 'adaptive reuse', 'loft apartments',
    'now houses', 'transformed'
  ],
  'active': [
    'active', 'operating', 'open', 'in use', 'functional', 'running',
    'currently', 'still operates', 'continues'
  ],
  'unknown': []
};

// =============================================================================
// AUTO-TAGGER SERVICE
// =============================================================================

export class AutoTaggerService {
  private db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  /**
   * Detect location type from text
   */
  detectLocationType(text: string): { type: LocationType; confidence: number } {
    const normalizedText = text.toLowerCase();
    const scores: Map<LocationType, number> = new Map();

    for (const [locType, keywords] of Object.entries(LOCATION_TYPE_KEYWORDS)) {
      if (locType === 'other') continue;

      let score = 0;
      let matches = 0;

      for (const keyword of keywords) {
        const regex = new RegExp(`\\b${this.escapeRegex(keyword)}\\b`, 'gi');
        const matchCount = (normalizedText.match(regex) || []).length;
        if (matchCount > 0) {
          // Weight by keyword specificity (longer keywords are more specific)
          score += matchCount * (1 + keyword.length / 20);
          matches++;
        }
      }

      if (matches > 0) {
        // Normalize score
        scores.set(locType as LocationType, score);
      }
    }

    // Find best match
    let bestType: LocationType = 'other';
    let bestScore = 0;

    for (const [type, score] of scores) {
      if (score > bestScore) {
        bestScore = score;
        bestType = type;
      }
    }

    // Calculate confidence (0-1)
    const confidence = bestScore > 0 ? Math.min(1, bestScore / 10) : 0;

    return { type: bestType, confidence };
  }

  /**
   * Detect era from build year
   */
  detectEra(buildYear: number | string | null): { era: Era | null; confidence: number } {
    if (!buildYear) {
      return { era: null, confidence: 0 };
    }

    // Parse year
    let year: number;
    if (typeof buildYear === 'string') {
      const match = buildYear.match(/\d{4}/);
      if (!match) {
        return { era: null, confidence: 0 };
      }
      year = parseInt(match[0], 10);
    } else {
      year = buildYear;
    }

    // Validate year
    if (year < 1600 || year > new Date().getFullYear() + 1) {
      return { era: null, confidence: 0 };
    }

    // Map to era
    let era: Era;
    if (year < 1900) {
      era = 'pre-1900';
    } else if (year < 1930) {
      era = '1900-1930';
    } else if (year < 1960) {
      era = '1930-1960';
    } else if (year < 1990) {
      era = '1960-1990';
    } else {
      era = '1990-present';
    }

    // Confidence is high if year is known
    return { era, confidence: 0.9 };
  }

  /**
   * Detect era from text (when build year is not known)
   */
  detectEraFromText(text: string): { era: Era | null; confidence: number } {
    const normalizedText = text.toLowerCase();

    // Look for year mentions with context
    const buildPatterns = [
      /built\s+(?:in\s+)?(\d{4})/gi,
      /constructed\s+(?:in\s+)?(\d{4})/gi,
      /erected\s+(?:in\s+)?(\d{4})/gi,
      /established\s+(?:in\s+)?(\d{4})/gi,
      /opened\s+(?:in\s+)?(\d{4})/gi,
      /founded\s+(?:in\s+)?(\d{4})/gi,
      /dating\s+(?:from|to)\s+(\d{4})/gi,
    ];

    for (const pattern of buildPatterns) {
      const match = pattern.exec(normalizedText);
      if (match) {
        const year = parseInt(match[1], 10);
        const result = this.detectEra(year);
        if (result.era) {
          return { era: result.era, confidence: 0.7 }; // Lower confidence from text
        }
      }
    }

    return { era: null, confidence: 0 };
  }

  /**
   * Detect location status from text
   */
  detectStatus(text: string): { status: LocationStatus; confidence: number } {
    const normalizedText = text.toLowerCase();
    const scores: Map<LocationStatus, number> = new Map();

    for (const [status, keywords] of Object.entries(STATUS_KEYWORDS)) {
      if (status === 'unknown') continue;

      let score = 0;
      for (const keyword of keywords) {
        const regex = new RegExp(`\\b${this.escapeRegex(keyword)}\\b`, 'gi');
        const matchCount = (normalizedText.match(regex) || []).length;
        score += matchCount * (1 + keyword.length / 20);
      }

      if (score > 0) {
        scores.set(status as LocationStatus, score);
      }
    }

    // Find best match
    let bestStatus: LocationStatus = 'unknown';
    let bestScore = 0;

    for (const [status, score] of scores) {
      if (score > bestScore) {
        bestScore = score;
        bestStatus = status;
      }
    }

    // Default to 'abandoned' for urbex context if no clear status
    if (bestStatus === 'unknown' && normalizedText.length > 100) {
      bestStatus = 'abandoned';
    }

    const confidence = bestScore > 0 ? Math.min(1, bestScore / 5) : 0;

    return { status: bestStatus, confidence };
  }

  /**
   * Full tag detection from text and optional build year
   */
  detectTags(text: string, buildYear?: number | string | null): TagResult {
    const typeResult = this.detectLocationType(text);
    const statusResult = this.detectStatus(text);

    // Try build year first, then text for era
    let eraResult = buildYear
      ? this.detectEra(buildYear)
      : this.detectEraFromText(text);

    return {
      locationType: typeResult.confidence > 0.3 ? typeResult.type : null,
      era: eraResult.era,
      status: statusResult.status,
      confidence: {
        locationType: typeResult.confidence,
        era: eraResult.confidence,
        status: statusResult.confidence,
      },
    };
  }

  /**
   * Tag a location by ID
   * Updates the location's location_type, era fields
   */
  async tagLocation(locid: string): Promise<TagResult | null> {
    // Get location info
    const location = this.db.prepare(`
      SELECT locnam, category, built_year FROM locs WHERE locid = ?
    `).get(locid) as { locnam: string; category: string | null; built_year: string | null } | undefined;

    if (!location) {
      return null;
    }

    // Get all web source text for this location
    const webSources = this.db.prepare(`
      SELECT extracted_text, extracted_title, title FROM web_sources WHERE locid = ?
    `).all(locid) as Array<{ extracted_text: string | null; extracted_title: string | null; title: string | null }>;

    // Combine all text
    const allText = [
      location.locnam,
      location.category || '',
      ...webSources.map(ws => [ws.extracted_text, ws.extracted_title, ws.title].filter(Boolean).join(' '))
    ].join(' ');

    // Detect tags
    const result = this.detectTags(allText, location.built_year);

    // Update location
    this.db.prepare(`
      UPDATE locs SET
        location_type = ?,
        era = ?
      WHERE locid = ?
    `).run(
      result.locationType,
      result.era,
      locid
    );

    return result;
  }

  /**
   * Tag all locations that don't have tags
   */
  async tagAllUntagged(): Promise<{ tagged: number; failed: number }> {
    const untagged = this.db.prepare(`
      SELECT locid FROM locs WHERE location_type IS NULL
    `).all() as Array<{ locid: string }>;

    let tagged = 0;
    let failed = 0;

    for (const { locid } of untagged) {
      try {
        const result = await this.tagLocation(locid);
        if (result && result.locationType) {
          tagged++;
        }
      } catch (error) {
        console.error(`[AutoTagger] Failed to tag ${locid}:`, error);
        failed++;
      }
    }

    console.log(`[AutoTagger] Tagged ${tagged} locations, ${failed} failed`);
    return { tagged, failed };
  }

  /**
   * Escape regex special characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let autoTaggerInstance: AutoTaggerService | null = null;

export function getAutoTaggerService(db: SqliteDatabase): AutoTaggerService {
  if (!autoTaggerInstance) {
    autoTaggerInstance = new AutoTaggerService(db);
  }
  return autoTaggerInstance;
}
