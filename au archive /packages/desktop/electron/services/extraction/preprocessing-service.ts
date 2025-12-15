/**
 * Preprocessing Service
 *
 * Handles spaCy preprocessing of text before LLM extraction.
 * Auto-starts the spaCy server if not running (like other background services).
 *
 * KEY FUNCTIONS:
 * 1. Auto-spawn spaCy server on demand (no manual setup required)
 * 2. Call spaCy /preprocess endpoint
 * 3. Format sentences with verb/entity markup for prompts
 * 4. Build profile candidate strings
 * 5. Fallback gracefully if server unavailable
 *
 * @version 1.1 - Added auto-spawn capability
 */

import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { app } from 'electron';
import type {
  PreprocessingResult,
  PreprocessedSentence,
  ProfileCandidates,
  DocumentStats,
  VerbCategory,
  PreprocessingOptions,
  DEFAULT_PREPROCESSING_OPTIONS,
} from './preprocessing-types';

// =============================================================================
// CONSTANTS
// =============================================================================

const SPACY_DEFAULT_PORT = 8234;
const SPACY_TIMEOUT = 30000;
const SPACY_STARTUP_TIMEOUT = 60000; // 60s for model loading

// Verb category display names for prompts
const VERB_CATEGORY_LABELS: Record<VerbCategory, string> = {
  build_date: 'construction',
  opening: 'opening',
  closure: 'closure',
  demolition: 'demolition',
  renovation: 'renovation',
  event: 'event',
  visit: 'visit',
  publication: 'publication',
  ownership: 'ownership',
};

// =============================================================================
// PREPROCESSING SERVICE CLASS
// =============================================================================

export class PreprocessingService {
  private port: number;
  private baseUrl: string;
  private serverProcess: ChildProcess | null = null;
  private initialized = false;
  private serverAvailable = false;

  constructor(port: number = SPACY_DEFAULT_PORT) {
    this.port = port;
    this.baseUrl = `http://localhost:${this.port}`;
  }

  /**
   * Initialize the service - auto-spawn server if needed
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Check if server is already running
    if (await this.checkHealth()) {
      console.log('[PreprocessingService] spaCy server already running');
      this.serverAvailable = true;
      this.initialized = true;
      return;
    }

    // Try to auto-spawn the server
    console.log('[PreprocessingService] spaCy server not running, attempting auto-spawn...');
    try {
      await this.spawnServer();
      this.serverAvailable = true;
    } catch (error) {
      console.warn('[PreprocessingService] Could not start spaCy server:', error);
      console.log('[PreprocessingService] Will use fallback preprocessing (basic sentence split)');
      this.serverAvailable = false;
    }

    this.initialized = true;
  }

  /**
   * Check if the spaCy preprocessing service is available
   */
  async isAvailable(): Promise<boolean> {
    await this.initialize();
    return this.serverAvailable;
  }

  /**
   * Check server health (without initializing)
   */
  private async checkHealth(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Find the spaCy server script path
   */
  private async findServerScript(): Promise<string | null> {
    const appPath = app.getAppPath();

    const candidates = [
      // From Electron app path
      path.resolve(appPath, '../../scripts/spacy-server/main.py'),
      // From dist-electron/main/
      path.resolve(__dirname, '../../../../scripts/spacy-server/main.py'),
      // From source location in dev
      path.resolve(__dirname, '../../../../../scripts/spacy-server/main.py'),
      // From working directory
      path.resolve(process.cwd(), 'scripts/spacy-server/main.py'),
      // If cwd is packages/desktop
      path.resolve(process.cwd(), '../../scripts/spacy-server/main.py'),
    ];

    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // Continue to next candidate
      }
    }

    return null;
  }

  /**
   * Find Python executable (prefer venv)
   */
  private async findPython(): Promise<string> {
    const appPath = app.getAppPath();

    const venvCandidates = [
      path.resolve(appPath, '../../scripts/spacy-server/venv/bin/python3'),
      path.resolve(__dirname, '../../../../scripts/spacy-server/venv/bin/python3'),
      path.resolve(process.cwd(), 'scripts/spacy-server/venv/bin/python3'),
      path.resolve(process.cwd(), '../../scripts/spacy-server/venv/bin/python3'),
    ];

    for (const venv of venvCandidates) {
      try {
        await fs.access(venv);
        return venv;
      } catch {
        // Continue
      }
    }

    return 'python3';
  }

  /**
   * Spawn the spaCy server process
   */
  private async spawnServer(): Promise<void> {
    const scriptPath = await this.findServerScript();
    if (!scriptPath) {
      throw new Error('spaCy server script not found');
    }

    const pythonPath = await this.findPython();
    console.log(`[PreprocessingService] Starting server: ${pythonPath} ${scriptPath}`);

    return new Promise((resolve, reject) => {
      this.serverProcess = spawn(pythonPath, [scriptPath], {
        env: {
          ...process.env,
          SPACY_PORT: String(this.port),
          SPACY_HOST: '127.0.0.1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      let startupOutput = '';
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error(`spaCy server startup timed out. Output: ${startupOutput}`));
        }
      }, SPACY_STARTUP_TIMEOUT);

      this.serverProcess.stdout?.on('data', async (data) => {
        startupOutput += data.toString();
        console.log(`[spaCy] ${data.toString().trim()}`);

        // Check if server is ready
        if (!resolved && startupOutput.includes('Uvicorn running')) {
          // Wait a moment then verify
          await new Promise(r => setTimeout(r, 1000));
          if (await this.checkHealth()) {
            resolved = true;
            clearTimeout(timeout);
            resolve();
          }
        }
      });

      this.serverProcess.stderr?.on('data', (data) => {
        console.error(`[spaCy ERROR] ${data.toString().trim()}`);
      });

      this.serverProcess.on('error', (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(err);
        }
      });

      this.serverProcess.on('close', (code) => {
        if (!resolved && code !== 0) {
          resolved = true;
          clearTimeout(timeout);
          reject(new Error(`spaCy server exited with code ${code}`));
        }
        this.serverProcess = null;
      });
    });
  }

  /**
   * Shutdown the server if we spawned it
   */
  async shutdown(): Promise<void> {
    if (this.serverProcess) {
      console.log('[PreprocessingService] Shutting down spaCy server...');
      this.serverProcess.kill();
      this.serverProcess = null;
    }
  }

  /**
   * Preprocess text using spaCy
   *
   * @param text - Raw text to preprocess
   * @param articleDate - Optional article date for context
   * @param maxSentences - Maximum sentences to include in LLM context
   * @returns Preprocessing result
   */
  async preprocess(
    text: string,
    articleDate?: string,
    maxSentences: number = 20
  ): Promise<PreprocessingResult> {
    const startTime = Date.now();

    // Auto-initialize (spawns server if needed)
    await this.initialize();

    // If server not available, use fallback immediately
    if (!this.serverAvailable) {
      return this.createFallbackResult(text, articleDate);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), SPACY_TIMEOUT);

      const response = await fetch(`${this.baseUrl}/preprocess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          articleDate,
          maxSentences,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Preprocessing failed: ${error}`);
      }

      const result = (await response.json()) as PreprocessingResult;
      result.processing_time_ms = Date.now() - startTime;

      return result;
    } catch (error) {
      // If preprocessing fails, return a minimal result
      console.error('[PreprocessingService] Preprocessing failed:', error);

      return this.createFallbackResult(text, articleDate);
    }
  }

  /**
   * Create a fallback result when preprocessing fails
   * Allows extraction to continue with raw text
   */
  private createFallbackResult(text: string, articleDate?: string): PreprocessingResult {
    // Simple sentence split as fallback
    const sentences = text
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 10);

    return {
      document_stats: {
        total_sentences: sentences.length,
        timeline_relevant: 0,
        profile_relevant: 0,
        total_people: 0,
        total_organizations: 0,
      },
      sentences: sentences.map((s) => ({
        text: s,
        relevancy: 'context' as const,
        relevancy_type: null,
        verbs: [],
        entities: [],
        confidence: 0.3,
        has_date: false,
        has_person: false,
        has_org: false,
      })),
      timeline_candidates: [],
      profile_candidates: {
        people: [],
        organizations: [],
      },
      llm_context: text.substring(0, 5000), // Truncate for safety
      article_date: articleDate || null,
      processing_time_ms: 0,
    };
  }

  /**
   * Format preprocessing result for date extraction prompt
   *
   * Creates a structured string showing:
   * - Timeline-relevant sentences with verb annotations
   * - Entity highlights
   */
  formatForDateExtraction(result: PreprocessingResult): string {
    if (result.timeline_candidates.length === 0) {
      return 'No timeline-relevant sentences detected by preprocessing.\nPlease analyze the full text for dates.';
    }

    const lines: string[] = [];

    for (let i = 0; i < result.timeline_candidates.length; i++) {
      const sent = result.timeline_candidates[i];

      // Sentence with relevancy info
      lines.push(`[${i + 1}] "${sent.text}"`);

      // Verb annotations
      if (sent.verbs.length > 0) {
        const verbList = sent.verbs
          .map((v) => `${v.text} (${VERB_CATEGORY_LABELS[v.category] || v.category})`)
          .join(', ');
        lines.push(`    Verbs: ${verbList}`);
      }

      // Date entities
      const dates = sent.entities.filter((e) => e.type === 'DATE');
      if (dates.length > 0) {
        lines.push(`    Dates: ${dates.map((d) => d.text).join(', ')}`);
      }

      // Confidence
      lines.push(`    Relevancy: ${sent.relevancy} (${Math.round(sent.confidence * 100)}%)`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Format preprocessing result for profile extraction prompt
   *
   * Creates structured lists of profile candidates
   */
  formatForProfileExtraction(result: PreprocessingResult): {
    people: string;
    organizations: string;
  } {
    // Format people candidates
    const peopleLines: string[] = [];
    for (const person of result.profile_candidates.people) {
      peopleLines.push(`- "${person.name}"`);
      if (person.implied_role) {
        peopleLines.push(`  Role: ${person.implied_role}`);
      }
      if (person.contexts && person.contexts.length > 0) {
        peopleLines.push(`  Context: "${person.contexts[0].substring(0, 100)}..."`);
      }
      peopleLines.push(`  Mentions: ${person.mention_count}`);
    }

    // Format organization candidates
    const orgLines: string[] = [];
    for (const org of result.profile_candidates.organizations) {
      orgLines.push(`- "${org.name}"`);
      if (org.implied_type) {
        orgLines.push(`  Type: ${org.implied_type}`);
      }
      if (org.implied_relationship) {
        orgLines.push(`  Relationship: ${org.implied_relationship}`);
      }
      if (org.contexts && org.contexts.length > 0) {
        orgLines.push(`  Context: "${org.contexts[0].substring(0, 100)}..."`);
      }
      orgLines.push(`  Mentions: ${org.mention_count}`);
    }

    return {
      people: peopleLines.length > 0 ? peopleLines.join('\n') : 'None detected',
      organizations: orgLines.length > 0 ? orgLines.join('\n') : 'None detected',
    };
  }

  /**
   * Format preprocessing result for TLDR prompt
   *
   * Creates summary of extracted entities for context
   */
  formatForTLDR(
    result: PreprocessingResult,
    extractedDates?: Array<{ parsedDate: string | null; category: string }>,
    extractedPeople?: Array<{ fullName: string; role: string }>,
    extractedOrgs?: Array<{ fullName: string; orgType: string }>
  ): {
    dates: string;
    people: string;
    organizations: string;
  } {
    // Use extracted data if provided, otherwise fall back to preprocessing
    let datesStr: string;
    if (extractedDates && extractedDates.length > 0) {
      datesStr = extractedDates
        .filter((d) => d.parsedDate)
        .map((d) => `${d.parsedDate} (${d.category})`)
        .join(', ');
    } else {
      // Fall back to dates from preprocessing
      const dateEntities = result.sentences
        .flatMap((s) => s.entities)
        .filter((e) => e.type === 'DATE')
        .map((e) => e.text);
      datesStr = dateEntities.length > 0 ? [...new Set(dateEntities)].join(', ') : 'None found';
    }

    let peopleStr: string;
    if (extractedPeople && extractedPeople.length > 0) {
      peopleStr = extractedPeople.map((p) => `${p.fullName} (${p.role})`).join(', ');
    } else {
      peopleStr =
        result.profile_candidates.people.length > 0
          ? result.profile_candidates.people.map((p) => p.name).join(', ')
          : 'None found';
    }

    let orgsStr: string;
    if (extractedOrgs && extractedOrgs.length > 0) {
      orgsStr = extractedOrgs.map((o) => `${o.fullName} (${o.orgType})`).join(', ');
    } else {
      orgsStr =
        result.profile_candidates.organizations.length > 0
          ? result.profile_candidates.organizations.map((o) => o.name).join(', ')
          : 'None found';
    }

    return {
      dates: datesStr,
      people: peopleStr,
      organizations: orgsStr,
    };
  }

  /**
   * Get verb categories from spaCy service
   */
  async getVerbCategories(): Promise<Record<VerbCategory, string[]>> {
    // Auto-initialize (spawns server if needed)
    await this.initialize();

    if (!this.serverAvailable) {
      return {} as Record<VerbCategory, string[]>;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.baseUrl}/verb-categories`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return (await response.json()) as Record<VerbCategory, string[]>;
      }
    } catch {
      // Return empty if service unavailable
    }

    return {} as Record<VerbCategory, string[]>;
  }

  /**
   * Calculate a relevancy score for the document
   *
   * Higher scores indicate more timeline-relevant content
   */
  calculateRelevancyScore(result: PreprocessingResult): {
    score: number;
    breakdown: {
      timelineRelevancy: number;
      profileRelevancy: number;
      dateEntities: number;
      verbDensity: number;
    };
  } {
    const stats = result.document_stats;

    // Timeline relevancy (0-40 points)
    const timelineRelevancy =
      stats.total_sentences > 0
        ? Math.min(40, (stats.timeline_relevant / stats.total_sentences) * 100)
        : 0;

    // Profile relevancy (0-20 points)
    const profileRelevancy =
      stats.total_sentences > 0
        ? Math.min(20, (stats.profile_relevant / stats.total_sentences) * 50)
        : 0;

    // Date entities (0-20 points)
    const dateCount = result.sentences
      .flatMap((s) => s.entities)
      .filter((e) => e.type === 'DATE').length;
    const dateEntities = Math.min(20, dateCount * 5);

    // Verb density (0-20 points)
    const verbCount = result.sentences.flatMap((s) => s.verbs).length;
    const verbDensity = Math.min(20, verbCount * 4);

    const totalScore = timelineRelevancy + profileRelevancy + dateEntities + verbDensity;

    return {
      score: Math.round(totalScore),
      breakdown: {
        timelineRelevancy: Math.round(timelineRelevancy),
        profileRelevancy: Math.round(profileRelevancy),
        dateEntities: Math.round(dateEntities),
        verbDensity: Math.round(verbDensity),
      },
    };
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Normalize a name for deduplication
 * - Lowercase
 * - Remove titles (Mr., Mrs., Dr., etc.)
 * - Collapse whitespace
 * - Remove punctuation
 */
export function normalizeName(name: string): string {
  if (!name) return '';

  return name
    .toLowerCase()
    .replace(/\b(mr\.?|mrs\.?|ms\.?|dr\.?|prof\.?|jr\.?|sr\.?|iii?|iv)\b/gi, '')
    .replace(/[.,'"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize an organization name for deduplication
 * - Lowercase
 * - Remove common suffixes (Inc., LLC, Corp., etc.)
 * - Remove "The" prefix
 * - Collapse whitespace
 */
export function normalizeOrgName(name: string): string {
  if (!name) return '';

  return name
    .toLowerCase()
    .replace(/\b(inc\.?|llc\.?|corp\.?|corporation|company|co\.?|ltd\.?|limited)\b/gi, '')
    .replace(/^the\s+/i, '')
    .replace(/[.,'"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract the primary verb category from a sentence
 * Returns the most relevant category based on verb matches
 */
export function getPrimarVerbCategory(
  sentence: PreprocessedSentence
): VerbCategory | null {
  if (sentence.verbs.length === 0) return null;

  // Priority order for categories
  const priority: VerbCategory[] = [
    'build_date',
    'demolition',
    'closure',
    'opening',
    'renovation',
    'event',
    'ownership',
    'visit',
    'publication',
  ];

  for (const cat of priority) {
    if (sentence.verbs.some((v) => v.category === cat)) {
      return cat;
    }
  }

  return sentence.verbs[0].category;
}

/**
 * Check if a sentence is timeline-relevant
 */
export function isTimelineRelevant(sentence: PreprocessedSentence): boolean {
  return (
    sentence.relevancy === 'timeline' || sentence.relevancy === 'timeline_possible'
  );
}

/**
 * Check if a sentence has strong timeline indicators
 * (both verb and date present)
 */
export function hasStrongTimelineIndicators(sentence: PreprocessedSentence): boolean {
  return sentence.verbs.length > 0 && sentence.has_date;
}

/**
 * Format a date entity with its verb context for display
 */
export function formatDateWithContext(
  dateText: string,
  verbContext: string | undefined,
  category: VerbCategory | string
): string {
  const categoryLabel = VERB_CATEGORY_LABELS[category as VerbCategory] || category;

  if (verbContext) {
    return `${dateText} (${verbContext} - ${categoryLabel})`;
  }

  return `${dateText} (${categoryLabel})`;
}

// =============================================================================
// SINGLETON INSTANCE
// =============================================================================

let serviceInstance: PreprocessingService | null = null;

/**
 * Get the preprocessing service singleton
 */
export function getPreprocessingService(port?: number): PreprocessingService {
  if (!serviceInstance || (port && port !== SPACY_DEFAULT_PORT)) {
    serviceInstance = new PreprocessingService(port);
  }
  return serviceInstance;
}

// =============================================================================
// EXPORTS
// =============================================================================

export type { PreprocessingResult, PreprocessedSentence, ProfileCandidates, DocumentStats };
