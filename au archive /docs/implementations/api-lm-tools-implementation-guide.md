# API LM Tools Implementation Guide

**Version:** 1.0
**Date:** 2025-12-14
**Status:** IMPLEMENTATION IN PROGRESS

---

## Overview

This guide provides step-by-step implementation details for the API LM Tools Overhaul. Follow each section in order.

---

## Table of Contents

1. [Phase 1: spaCy Preprocessing Enhancement](#phase-1-spacy-preprocessing-enhancement)
2. [Phase 2: TypeScript Types](#phase-2-typescript-types)
3. [Phase 3: Database Migrations](#phase-3-database-migrations)
4. [Phase 4: Prompt Templates with Versioning](#phase-4-prompt-templates-with-versioning)
5. [Phase 5: Preprocessing Services](#phase-5-preprocessing-services)
6. [Phase 6: Profile Extraction Agents](#phase-6-profile-extraction-agents)
7. [Phase 7: Conflict Detection System](#phase-7-conflict-detection-system)
8. [Phase 8: Timeline Event Merging](#phase-8-timeline-event-merging)
9. [Phase 9: IPC Handlers](#phase-9-ipc-handlers)
10. [Phase 10: UI Components](#phase-10-ui-components)

---

## Phase 1: spaCy Preprocessing Enhancement

### 1.1 New Python Files

**File: `packages/desktop/electron/python/spacy-service/verb_patterns.py`**

Purpose: Define verb patterns for timeline relevancy detection.

```python
"""
Verb Patterns for Timeline Relevancy Detection

Maps verbs to timeline categories for date extraction preprocessing.
"""

TIMELINE_VERBS = {
    'build_date': [
        'built', 'constructed', 'erected', 'established', 'founded',
        'completed', 'created', 'designed', 'developed', 'made',
        'dating from', 'dates from', 'originated', 'commissioned'
    ],
    'opening': [
        'opened', 'inaugurated', 'launched', 'began operations',
        'started operations', 'commenced', 'debuted', 'premiered',
        'ribbon cutting', 'grand opening', 'dedicated'
    ],
    'closure': [
        'closed', 'shut down', 'shuttered', 'abandoned', 'ceased operations',
        'stopped operations', 'went out of business', 'liquidated',
        'bankrupt', 'foreclosed', 'vacated', 'left empty'
    ],
    'demolition': [
        'demolished', 'torn down', 'razed', 'destroyed', 'bulldozed',
        'knocked down', 'leveled', 'wrecked', 'dismantled', 'imploded'
    ],
    'renovation': [
        'renovated', 'restored', 'refurbished', 'rebuilt', 'expanded',
        'remodeled', 'upgraded', 'modernized', 'repaired', 'improved',
        'converted', 'transformed', 'repurposed'
    ],
    'event': [
        'burned', 'flooded', 'collapsed', 'exploded', 'damaged',
        'fire', 'explosion', 'accident', 'incident', 'disaster',
        'struck', 'hit', 'destroyed by', 'ravaged'
    ],
    'visit': [
        'visited', 'explored', 'photographed', 'toured', 'documented',
        'discovered', 'found', 'stumbled upon', 'came across', 'surveyed'
    ],
    'publication': [
        'published', 'posted', 'wrote', 'updated', 'reported',
        'documented', 'recorded', 'noted', 'mentioned', 'featured'
    ]
}

# Flatten for quick lookup
ALL_TIMELINE_VERBS = {}
for category, verbs in TIMELINE_VERBS.items():
    for verb in verbs:
        ALL_TIMELINE_VERBS[verb.lower()] = category

def get_verb_category(verb: str) -> str | None:
    """Get the timeline category for a verb."""
    return ALL_TIMELINE_VERBS.get(verb.lower())

def find_verbs_in_text(text: str) -> list[dict]:
    """Find all timeline verbs in text with positions."""
    text_lower = text.lower()
    found = []

    for verb, category in ALL_TIMELINE_VERBS.items():
        pos = 0
        while True:
            pos = text_lower.find(verb, pos)
            if pos == -1:
                break
            # Check word boundary
            before_ok = pos == 0 or not text_lower[pos-1].isalnum()
            after_ok = pos + len(verb) >= len(text_lower) or not text_lower[pos + len(verb)].isalnum()
            if before_ok and after_ok:
                found.append({
                    'text': verb,
                    'category': category,
                    'position': pos
                })
            pos += len(verb)

    return sorted(found, key=lambda x: x['position'])
```

**File: `packages/desktop/electron/python/spacy-service/preprocessor.py`**

Purpose: Intelligent preprocessing for LLM input.

```python
"""
Preprocessor for LLM Input

Uses spaCy for NER and sentence segmentation, combined with verb detection
to create structured context packages for LLM extraction.
"""

import spacy
from typing import Optional
from verb_patterns import find_verbs_in_text, get_verb_category, TIMELINE_VERBS

# Load spaCy model
nlp = spacy.load("en_core_web_lg")

# False positive patterns (not dates)
FALSE_POSITIVE_PATTERNS = [
    r'\d+\s*(?:to|[-–])\s*\d+\s*(?:employees?|workers?|people|staff)',  # Employee counts
    r'\$[\d,]+',  # Currency
    r'\d+\s*(?:feet|ft|meters?|m|inches?|in|yards?|miles?)',  # Measurements
    r'\d{1,2}:\d{2}',  # Times
    r'\(\d{3}\)\s*\d{3}[-.\s]?\d{4}',  # Phone numbers
    r'(?:route|highway|interstate|i-)\s*\d+',  # Route numbers
    r'\d+%',  # Percentages
    r'[-]?\d+\.\d+,\s*[-]?\d+\.\d+',  # Coordinates
]

def classify_sentence(sent_text: str, entities: list[dict], verbs: list[dict]) -> dict:
    """Classify a sentence by its relevancy to timeline/profiles."""

    # Check for timeline verbs
    has_timeline_verb = len(verbs) > 0
    has_date_entity = any(e['type'] == 'DATE' for e in entities)
    has_person_entity = any(e['type'] == 'PERSON' for e in entities)
    has_org_entity = any(e['type'] == 'ORG' for e in entities)

    # Determine relevancy
    if has_timeline_verb and has_date_entity:
        relevancy = 'timeline'
        relevancy_type = verbs[0]['category'] if verbs else None
        confidence = 0.95
    elif has_timeline_verb:
        relevancy = 'timeline_possible'
        relevancy_type = verbs[0]['category'] if verbs else None
        confidence = 0.7
    elif has_person_entity or has_org_entity:
        relevancy = 'profile'
        relevancy_type = 'person' if has_person_entity else 'organization'
        confidence = 0.8
    else:
        relevancy = 'context'
        relevancy_type = None
        confidence = 0.3

    return {
        'relevancy': relevancy,
        'relevancy_type': relevancy_type,
        'confidence': confidence
    }

def preprocess_text(text: str, article_date: Optional[str] = None) -> dict:
    """
    Preprocess text for LLM extraction.

    Returns structured context package with:
    - Sentence-level analysis
    - Entity extraction
    - Verb detection
    - Relevancy classification
    """
    doc = nlp(text)

    sentences = []
    timeline_candidates = []
    profile_candidates = {'people': [], 'organizations': []}

    for sent in doc.sents:
        sent_text = sent.text.strip()
        if not sent_text:
            continue

        # Get entities in this sentence
        entities = []
        for ent in doc.ents:
            if ent.start_char >= sent.start_char and ent.end_char <= sent.end_char:
                entities.append({
                    'text': ent.text,
                    'type': ent.label_,
                    'start': ent.start_char - sent.start_char,
                    'end': ent.end_char - sent.start_char
                })

        # Find verbs in sentence
        verbs = find_verbs_in_text(sent_text)

        # Classify sentence
        classification = classify_sentence(sent_text, entities, verbs)

        sentence_data = {
            'text': sent_text,
            'relevancy': classification['relevancy'],
            'relevancy_type': classification['relevancy_type'],
            'verbs': verbs,
            'entities': entities,
            'confidence': classification['confidence']
        }
        sentences.append(sentence_data)

        # Track timeline candidates
        if classification['relevancy'] in ('timeline', 'timeline_possible'):
            timeline_candidates.append(sentence_data)

        # Track profile candidates
        for ent in entities:
            if ent['type'] == 'PERSON':
                profile_candidates['people'].append({
                    'name': ent['text'],
                    'context': sent_text,
                    'implied_role': _infer_role(sent_text, ent['text'])
                })
            elif ent['type'] == 'ORG':
                profile_candidates['organizations'].append({
                    'name': ent['text'],
                    'context': sent_text,
                    'implied_type': _infer_org_type(sent_text, ent['text'])
                })

    # Deduplicate profile candidates
    profile_candidates['people'] = _dedupe_profiles(profile_candidates['people'])
    profile_candidates['organizations'] = _dedupe_profiles(profile_candidates['organizations'])

    return {
        'document_stats': {
            'total_sentences': len(sentences),
            'timeline_relevant': len([s for s in sentences if s['relevancy'] in ('timeline', 'timeline_possible')]),
            'profile_relevant': len([s for s in sentences if s['relevancy'] == 'profile'])
        },
        'sentences': sentences,
        'timeline_candidates': timeline_candidates,
        'profile_candidates': profile_candidates,
        'article_date': article_date
    }

def _infer_role(context: str, name: str) -> Optional[str]:
    """Infer person's role from context."""
    context_lower = context.lower()

    role_keywords = {
        'founder': ['founded', 'founder', 'established by', 'started by'],
        'owner': ['owned', 'owner', 'proprietor', 'purchased by'],
        'architect': ['designed', 'architect', 'designed by'],
        'developer': ['developed', 'developer', 'built by'],
        'employee': ['worked', 'employee', 'worker', 'employed'],
        'photographer': ['photographed', 'photographer', 'photo by'],
        'visitor': ['visited', 'explored', 'toured']
    }

    for role, keywords in role_keywords.items():
        if any(kw in context_lower for kw in keywords):
            return role

    return None

def _infer_org_type(context: str, name: str) -> Optional[str]:
    """Infer organization type from context."""
    context_lower = context.lower()
    name_lower = name.lower()

    type_keywords = {
        'company': ['company', 'corporation', 'corp', 'inc', 'llc', 'factory', 'plant', 'mill'],
        'hospital': ['hospital', 'medical', 'clinic', 'health'],
        'school': ['school', 'university', 'college', 'academy', 'institute'],
        'church': ['church', 'cathedral', 'chapel', 'temple', 'synagogue'],
        'government': ['department', 'agency', 'bureau', 'city of', 'state of', 'county'],
        'military': ['army', 'navy', 'air force', 'military', 'base', 'fort']
    }

    for org_type, keywords in type_keywords.items():
        if any(kw in context_lower or kw in name_lower for kw in keywords):
            return org_type

    return None

def _dedupe_profiles(profiles: list[dict]) -> list[dict]:
    """Deduplicate profiles by name, keeping all contexts."""
    seen = {}
    for p in profiles:
        name = p['name'].lower().strip()
        if name in seen:
            seen[name]['contexts'] = seen[name].get('contexts', [seen[name]['context']])
            seen[name]['contexts'].append(p['context'])
        else:
            seen[name] = p.copy()

    return list(seen.values())
```

### 1.2 Update main.py

Add new `/preprocess` endpoint to the spaCy service.

---

## Phase 2: TypeScript Types

### 2.1 New Types File

**File: `packages/desktop/electron/services/extraction/preprocessing-types.ts`**

```typescript
/**
 * Preprocessing Types
 *
 * Types for spaCy preprocessing output and LLM input packages.
 */

export interface PreprocessedSentence {
  text: string;
  relevancy: 'timeline' | 'timeline_possible' | 'profile' | 'context';
  relevancy_type: string | null;
  verbs: VerbMatch[];
  entities: EntityMatch[];
  confidence: number;
}

export interface VerbMatch {
  text: string;
  category: VerbCategory;
  position: number;
}

export type VerbCategory =
  | 'build_date'
  | 'opening'
  | 'closure'
  | 'demolition'
  | 'renovation'
  | 'event'
  | 'visit'
  | 'publication';

export interface EntityMatch {
  text: string;
  type: 'PERSON' | 'ORG' | 'DATE' | 'GPE' | 'LOC' | 'FAC';
  start: number;
  end: number;
}

export interface ProfileCandidate {
  name: string;
  context: string;
  contexts?: string[];
  implied_role?: string;
  implied_type?: string;
}

export interface PreprocessingResult {
  document_stats: {
    total_sentences: number;
    timeline_relevant: number;
    profile_relevant: number;
  };
  sentences: PreprocessedSentence[];
  timeline_candidates: PreprocessedSentence[];
  profile_candidates: {
    people: ProfileCandidate[];
    organizations: ProfileCandidate[];
  };
  article_date?: string;
}

export interface PreprocessingOptions {
  usePreprocessing: boolean;
  preprocessingMode: 'full' | 'verbs_only' | 'entities_only';
  fallbackToRawText: boolean;
}
```

### 2.2 Profile Types

**File: `packages/desktop/electron/services/extraction/profile-types.ts`**

```typescript
/**
 * Profile Types
 *
 * Types for people and company profiles.
 */

export interface PersonProfile {
  profile_id: string;
  locid: string;
  full_name: string;
  normalized_name: string;
  role: PersonRole;
  date_start?: string;
  date_end?: string;
  key_facts: string[];
  photo_hash?: string;
  social_links?: SocialLinks;
  source_refs: string[];
  aliases: string[];
  confidence: number;
  status: ProfileStatus;
  created_at: string;
}

export interface CompanyProfile {
  profile_id: string;
  locid: string;
  full_name: string;
  normalized_name: string;
  org_type: OrganizationType;
  industry?: string;
  relationship: CompanyRelationship;
  date_start?: string;
  date_end?: string;
  key_facts: string[];
  logo_hash?: string;
  logo_source?: string;
  source_refs: string[];
  aliases: string[];
  confidence: number;
  status: ProfileStatus;
  created_at: string;
}

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

export type OrganizationType =
  | 'company'
  | 'government'
  | 'school'
  | 'hospital'
  | 'church'
  | 'nonprofit'
  | 'military'
  | 'unknown';

export type CompanyRelationship =
  | 'owner'
  | 'operator'
  | 'tenant'
  | 'builder'
  | 'demolisher'
  | 'unknown';

export type ProfileStatus = 'pending' | 'approved' | 'rejected' | 'merged';

export interface SocialLinks {
  findagrave?: string;
  newspapers_com?: string;
  ancestry?: string;
  wikipedia?: string;
  linkedin?: string;
}
```

### 2.3 Conflict Types

**File: `packages/desktop/electron/services/extraction/conflict-types.ts`**

```typescript
/**
 * Conflict Types
 *
 * Types for fact conflict detection and resolution.
 */

export interface FactConflict {
  conflict_id: string;
  locid: string;
  conflict_type: ConflictType;
  field_name: string;

  claim_a: ConflictClaim;
  claim_b: ConflictClaim;

  resolved: boolean;
  resolution?: ConflictResolution;
  resolution_notes?: string;
  resolved_by?: string;
  resolved_at?: string;

  created_at: string;
}

export interface ConflictClaim {
  value: string;
  source_ref: string;
  confidence: number;
  context?: string;
}

export type ConflictType =
  | 'date_mismatch'
  | 'name_mismatch'
  | 'fact_mismatch'
  | 'role_mismatch';

export type ConflictResolution =
  | 'claim_a'
  | 'claim_b'
  | 'both_valid'
  | 'neither'
  | 'merged';
```

---

## Phase 3: Database Migrations

### 3.1 Migration Code

Add to `packages/desktop/electron/main/database.ts` in the `runMigrations()` function:

```typescript
// Migration 77: People profiles table
const hasProfilesTable = sqlite.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='people_profiles'"
).get();

if (!hasProfilesTable) {
  sqlite.exec(`
    CREATE TABLE people_profiles (
      profile_id TEXT PRIMARY KEY,
      locid TEXT NOT NULL,
      full_name TEXT NOT NULL,
      normalized_name TEXT,
      role TEXT DEFAULT 'unknown',
      date_start TEXT,
      date_end TEXT,
      key_facts JSON,
      photo_hash TEXT,
      social_links JSON,
      source_refs JSON,
      aliases JSON,
      confidence REAL DEFAULT 0.5,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (locid) REFERENCES locs(locid) ON DELETE CASCADE
    );

    CREATE INDEX idx_people_profiles_locid ON people_profiles(locid);
    CREATE INDEX idx_people_profiles_normalized ON people_profiles(normalized_name);
    CREATE INDEX idx_people_profiles_status ON people_profiles(status);
  `);
  console.log('Migration 77: Created people_profiles table');
}

// Migration 78: Company profiles table
const hasCompanyTable = sqlite.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='company_profiles'"
).get();

if (!hasCompanyTable) {
  sqlite.exec(`
    CREATE TABLE company_profiles (
      profile_id TEXT PRIMARY KEY,
      locid TEXT NOT NULL,
      full_name TEXT NOT NULL,
      normalized_name TEXT,
      org_type TEXT DEFAULT 'unknown',
      industry TEXT,
      relationship TEXT DEFAULT 'unknown',
      date_start TEXT,
      date_end TEXT,
      key_facts JSON,
      logo_hash TEXT,
      logo_source TEXT,
      source_refs JSON,
      aliases JSON,
      confidence REAL DEFAULT 0.5,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (locid) REFERENCES locs(locid) ON DELETE CASCADE
    );

    CREATE INDEX idx_company_profiles_locid ON company_profiles(locid);
    CREATE INDEX idx_company_profiles_normalized ON company_profiles(normalized_name);
    CREATE INDEX idx_company_profiles_status ON company_profiles(status);
  `);
  console.log('Migration 78: Created company_profiles table');
}

// Migration 79: Fact conflicts table
const hasConflictsTable = sqlite.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='fact_conflicts'"
).get();

if (!hasConflictsTable) {
  sqlite.exec(`
    CREATE TABLE fact_conflicts (
      conflict_id TEXT PRIMARY KEY,
      locid TEXT NOT NULL,
      conflict_type TEXT NOT NULL,
      field_name TEXT NOT NULL,
      claim_a_value TEXT,
      claim_a_source TEXT,
      claim_a_confidence REAL,
      claim_a_context TEXT,
      claim_b_value TEXT,
      claim_b_source TEXT,
      claim_b_confidence REAL,
      claim_b_context TEXT,
      resolved INTEGER DEFAULT 0,
      resolution TEXT,
      resolution_notes TEXT,
      resolved_by TEXT,
      resolved_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (locid) REFERENCES locs(locid) ON DELETE CASCADE
    );

    CREATE INDEX idx_fact_conflicts_locid ON fact_conflicts(locid);
    CREATE INDEX idx_fact_conflicts_resolved ON fact_conflicts(resolved);
  `);
  console.log('Migration 79: Created fact_conflicts table');
}

// Migration 80: Extraction inputs for replay
const hasExtractionInputs = sqlite.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='extraction_inputs'"
).get();

if (!hasExtractionInputs) {
  sqlite.exec(`
    CREATE TABLE extraction_inputs (
      input_id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      locid TEXT,
      raw_text TEXT NOT NULL,
      preprocessing_json TEXT,
      extraction_json TEXT,
      prompt_version TEXT,
      provider TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (locid) REFERENCES locs(locid) ON DELETE SET NULL
    );

    CREATE INDEX idx_extraction_inputs_source ON extraction_inputs(source_type, source_id);
  `);
  console.log('Migration 80: Created extraction_inputs table');
}

// Migration 81: Source authority table
const hasSourceAuthority = sqlite.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='source_authority'"
).get();

if (!hasSourceAuthority) {
  sqlite.exec(`
    CREATE TABLE source_authority (
      domain TEXT PRIMARY KEY,
      tier INTEGER NOT NULL DEFAULT 3,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Default authority tiers
    INSERT INTO source_authority (domain, tier, notes) VALUES
      ('wikipedia.org', 2, 'Encyclopedia - verify citations'),
      ('newspapers.com', 1, 'Historical newspaper archive'),
      ('findagrave.com', 2, 'Cemetery records'),
      ('ancestry.com', 2, 'Genealogy records'),
      ('loc.gov', 1, 'Library of Congress'),
      ('archives.gov', 1, 'National Archives'),
      ('nps.gov', 1, 'National Park Service'),
      ('historicaerials.com', 2, 'Aerial photography archive');
  `);
  console.log('Migration 81: Created source_authority table with defaults');
}

// Migration 82: Add multi-source support to location_timeline
const timelineCols = sqlite.prepare("PRAGMA table_info(location_timeline)").all() as { name: string }[];
if (!timelineCols.some(c => c.name === 'source_refs')) {
  sqlite.exec(`
    ALTER TABLE location_timeline ADD COLUMN source_refs JSON;
    ALTER TABLE location_timeline ADD COLUMN verb_context TEXT;
    ALTER TABLE location_timeline ADD COLUMN prompt_version TEXT;
  `);
  console.log('Migration 82: Added multi-source columns to location_timeline');
}

// Migration 83: Add profile columns to entity_extractions
const entityCols = sqlite.prepare("PRAGMA table_info(entity_extractions)").all() as { name: string }[];
if (!entityCols.some(c => c.name === 'profile_json')) {
  sqlite.exec(`
    ALTER TABLE entity_extractions ADD COLUMN profile_json TEXT;
    ALTER TABLE entity_extractions ADD COLUMN normalized_name TEXT;
    ALTER TABLE entity_extractions ADD COLUMN aliases JSON;
    ALTER TABLE entity_extractions ADD COLUMN cross_location_refs JSON;
    ALTER TABLE entity_extractions ADD COLUMN prompt_version TEXT;
  `);
  console.log('Migration 83: Added profile columns to entity_extractions');
}
```

---

## Phase 4: Prompt Templates with Versioning

### 4.1 Versioned Prompts

**File: `packages/desktop/electron/services/extraction/agents/versioned-prompts.ts`**

```typescript
/**
 * Versioned Prompt Templates
 *
 * All prompts are versioned for A/B testing and rollback capability.
 * Store prompt_version with each extraction result.
 */

export interface PromptVersion {
  version: string;
  systemPrompt: string;
  userPrompt: string;
  description: string;
  dateAdded: string;
}

// =============================================================================
// DATE EXTRACTION PROMPTS
// =============================================================================

export const DATE_EXTRACTION_PROMPTS: Record<string, PromptVersion> = {
  'v1.0': {
    version: 'v1.0',
    description: 'Original date extraction prompt',
    dateAdded: '2025-12-01',
    systemPrompt: `You are an expert historian specializing in extracting dates from historical documents about abandoned places.`,
    userPrompt: `Extract ALL dates from this document...` // Original prompt
  },

  'v2.0': {
    version: 'v2.0',
    description: 'Verb-context required date extraction',
    dateAdded: '2025-12-14',
    systemPrompt: `You are an archive historian extracting FACTUAL dates from documents about abandoned places.

CRITICAL RULES:
1. ONLY extract dates that have EXPLICIT VERB CONTEXT
2. A date without a verb is NOT a timeline event
3. Numbers without date context are NEVER dates

VERB-DATE LINKAGE REQUIRED:
- "built in 1923" → VALID (verb: built, category: build_date)
- "1923" alone → INVALID (no verb context)
- "around 1920" → VALID only if verb present in sentence

AUDIT RULE: If you cannot identify the verb that gives the date meaning, do not extract it.`,
    userPrompt: `Extract dates from this preprocessed document.

## PREPROCESSED CONTEXT:
The following sentences have been identified as timeline-relevant by spaCy preprocessing.
Each sentence includes detected verbs and their categories.

{preprocessed_sentences}

## ORIGINAL TEXT (for reference):
{text}

## REQUIRED OUTPUT (JSON):
{
  "dates": [
    {
      "rawText": "exact quote containing the date",
      "parsedDate": "YYYY-MM-DD or YYYY-MM or YYYY",
      "parsedDateEnd": "for ranges only, otherwise null",
      "precision": "exact|month|year|decade|approximate",
      "category": "build_date|opening|closure|demolition|visit|publication|renovation|event|unknown",
      "verbContext": "the verb that gives this date meaning",
      "confidence": 0.0 to 1.0,
      "context": "the sentence containing this date",
      "isApproximate": true or false
    }
  ]
}

REMEMBER: Every date MUST have a verbContext. No verb = no extraction.`
  }
};

// =============================================================================
// PROFILE EXTRACTION PROMPTS
// =============================================================================

export const PROFILE_EXTRACTION_PROMPTS: Record<string, PromptVersion> = {
  'v1.0': {
    version: 'v1.0',
    description: 'Initial profile extraction prompt',
    dateAdded: '2025-12-14',
    systemPrompt: `You are an archive researcher building mini-profiles of people and organizations mentioned in historical documents.

FOR PEOPLE:
- Full name (standardized)
- Role: owner, architect, developer, employee, founder, visitor, photographer, historian
- Date range of involvement (if stated)
- Key facts (max 3, explicitly stated only)
- Aliases (other names used in document)

FOR ORGANIZATIONS:
- Full name (standardized)
- Type: company, government, school, hospital, church, nonprofit, military
- Industry/sector (if identifiable)
- Relationship to location: owner, operator, tenant, builder, demolisher
- Date range of operation (if stated)
- Key facts (max 3, explicitly stated only)
- Aliases (other names used in document)

AUDIT RULE: Only include facts explicitly stated in source. Never infer or assume.`,
    userPrompt: `Extract profiles from this document.

## PROFILE CANDIDATES (from spaCy):
{profile_candidates}

## FULL TEXT:
{text}

## REQUIRED OUTPUT (JSON):
{
  "people": [
    {
      "fullName": "John Sterling",
      "normalizedName": "john sterling",
      "role": "founder",
      "dateStart": "1923",
      "dateEnd": null,
      "keyFacts": ["Founded Sterling Steel Factory", "Automotive industry supplier"],
      "aliases": ["J. Sterling"],
      "confidence": 0.9
    }
  ],
  "organizations": [
    {
      "fullName": "Sterling Steel Factory",
      "normalizedName": "sterling steel factory",
      "orgType": "company",
      "industry": "steel manufacturing",
      "relationship": "owner",
      "dateStart": "1923",
      "dateEnd": "2008",
      "keyFacts": ["Automotive steel supplier", "Employed 500+ workers at peak"],
      "aliases": ["Sterling Steel", "Sterling"],
      "confidence": 0.95
    }
  ]
}

Only extract entities that appear in the profile candidates or are clearly mentioned.`
  }
};

// =============================================================================
// TLDR GENERATION PROMPTS
// =============================================================================

export const TLDR_PROMPTS: Record<string, PromptVersion> = {
  'v1.0': {
    version: 'v1.0',
    description: 'Initial TLDR generation prompt',
    dateAdded: '2025-12-14',
    systemPrompt: `You are an archivist creating timeline-optimized summaries.

TLDR FORMAT (for timeline events):
- Max 100 characters
- Focus on WHO did WHAT in WHEN
- Use past tense
- No speculation

TITLE FORMAT (for web sources):
- Max 60 characters
- Include location type if known
- Include key identifier (name, city, feature)`,
    userPrompt: `Generate TLDR and title for this document.

## LOCATION NAME: {locationName}
## KEY DATES FOUND: {dates}
## KEY ENTITIES FOUND: {entities}

## DOCUMENT TEXT:
{text}

## REQUIRED OUTPUT (JSON):
{
  "title": "Short title under 60 chars",
  "tldr": "Timeline TLDR under 100 chars",
  "keyFacts": ["Fact 1", "Fact 2", "Fact 3"],
  "confidence": 0.0 to 1.0
}`
  }
};

// =============================================================================
// PROMPT SELECTION
// =============================================================================

export type PromptType = 'date_extraction' | 'profile_extraction' | 'tldr';

const PROMPT_REGISTRIES: Record<PromptType, Record<string, PromptVersion>> = {
  'date_extraction': DATE_EXTRACTION_PROMPTS,
  'profile_extraction': PROFILE_EXTRACTION_PROMPTS,
  'tldr': TLDR_PROMPTS
};

// Default versions (can be changed in settings)
const DEFAULT_VERSIONS: Record<PromptType, string> = {
  'date_extraction': 'v2.0',
  'profile_extraction': 'v1.0',
  'tldr': 'v1.0'
};

export function getPrompt(type: PromptType, version?: string): PromptVersion {
  const registry = PROMPT_REGISTRIES[type];
  const v = version || DEFAULT_VERSIONS[type];

  if (!registry[v]) {
    console.warn(`Prompt version ${v} not found for ${type}, using default`);
    return registry[DEFAULT_VERSIONS[type]];
  }

  return registry[v];
}

export function getAllVersions(type: PromptType): string[] {
  return Object.keys(PROMPT_REGISTRIES[type]);
}

export function setDefaultVersion(type: PromptType, version: string): void {
  if (PROMPT_REGISTRIES[type][version]) {
    DEFAULT_VERSIONS[type] = version;
  }
}
```

---

## Phase 5-10: Continue in Implementation

(Remaining phases will be implemented in code following this guide structure)

---

## Audit Checklist

### Pre-Implementation
- [ ] All types defined and exported
- [ ] Database migrations tested standalone
- [ ] spaCy service endpoints documented
- [ ] Prompt versions catalogued

### Post-Implementation
- [ ] All IPC channels registered
- [ ] Preload bridge updated
- [ ] UI components render correctly
- [ ] Extraction pipeline tested end-to-end
- [ ] Conflict detection working
- [ ] Profile deduplication working
- [ ] Timeline merging working

### Final Verification
- [ ] No TypeScript errors
- [ ] No ESLint warnings
- [ ] Manual testing complete
- [ ] Performance acceptable (<500ms preprocessing overhead)

---

## Completion Tracking

| Phase | Status | Completion |
|-------|--------|------------|
| Phase 1: spaCy | Pending | 0% |
| Phase 2: Types | Pending | 0% |
| Phase 3: Migrations | Pending | 0% |
| Phase 4: Prompts | Pending | 0% |
| Phase 5: Services | Pending | 0% |
| Phase 6: Profiles | Pending | 0% |
| Phase 7: Conflicts | Pending | 0% |
| Phase 8: Merging | Pending | 0% |
| Phase 9: IPC | Pending | 0% |
| Phase 10: UI | Pending | 0% |
| **Overall** | **In Progress** | **0%** |

---

**END OF IMPLEMENTATION GUIDE**
