# API LM Tools Instructions Overhaul

**Version:** 1.0
**Date:** 2025-12-14
**Status:** PLANNING (Pending Human Review)

---

## Executive Summary

Overhaul the extraction system to create universal instructions for both local (Ollama) and online LLMs, with intelligent spaCy pre-processing to make LLM calls cleaner and more focused.

**Core Principle:** Archive accuracy first. All data must be audited for facts before confirmation.

---

## Current State Analysis

### What Exists

| Component | Location | Status |
|-----------|----------|--------|
| spaCy Provider | `electron/services/extraction/providers/spacy-provider.ts` | Working - NER only |
| Ollama Provider | `electron/services/extraction/providers/ollama-provider.ts` | Working - Full LLM |
| Prompt Templates | `electron/services/extraction/agents/prompt-templates.ts` | 761 lines, functional |
| Extraction Service | `electron/services/extraction/extraction-service.ts` | Orchestrator working |
| Queue Service | `electron/services/extraction/extraction-queue-service.ts` | Background processing |
| Timeline UI | `src/components/location/LocationResearchTimeline.svelte` | Shows events |
| People UI | `src/components/location/LocationResearchPeople.svelte` | Shows extracted people |
| Companies UI | `src/components/location/LocationResearchCompanies.svelte` | Shows orgs |

### Current Gaps

1. **No verb-based relevancy detection** - Dates extracted without understanding context
2. **No spaCy pre-filtering for LLM** - Ollama receives raw text, not preprocessed
3. **No mini-profile system** - People/companies are just names with roles
4. **Generic prompts** - Not optimized for archive-specific extraction
5. **No TLDR generation** - Summaries exist but not timeline-optimized TLDRs
6. **No source citation tracking** - Timeline events lack multi-source support

---

## Overhaul Architecture

### Phase 1: Universal LLM Instructions Framework

Create a shared instruction set that works across providers:

```
┌─────────────────────────────────────────────────────────────────┐
│                    EXTRACTION PIPELINE v2                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. RAW TEXT INPUT                                              │
│         ↓                                                        │
│  2. spaCy PRE-PROCESSING (Fast, Offline)                        │
│     • Named Entity Recognition                                   │
│     • Verb extraction (built, closed, demolished, etc.)         │
│     • Sentence segmentation with verb-entity proximity          │
│     • False positive filtering                                   │
│         ↓                                                        │
│  3. CONTEXT PACKAGE (spaCy output → LLM input)                  │
│     • Relevant sentences only (verb-filtered)                   │
│     • Pre-identified entities with positions                    │
│     • Sentence classifications (timeline-relevant, profile, etc)│
│         ↓                                                        │
│  4. LLM TASK DISPATCH (Ollama or Cloud)                         │
│     Task A: Date Extraction (with verb context)                 │
│     Task B: Entity Profiling (people/companies)                 │
│     Task C: TLDR Title Generation                               │
│     Task D: Summary Generation                                  │
│         ↓                                                        │
│  5. FACT AUDIT (before storage)                                 │
│     • Confidence scoring                                         │
│     • Source text verification                                   │
│     • Hallucination detection                                    │
│         ↓                                                        │
│  6. STRUCTURED OUTPUT                                            │
│     → Timeline Events (with sources)                            │
│     → People Profiles                                           │
│     → Company Profiles                                          │
│     → Web Source Summary                                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Phase 2: spaCy Pre-Processing Enhancement

Create new Python service endpoints for intelligent pre-processing:

**New Endpoint: `/preprocess`**

```python
# Input: Raw text
# Output: Structured context package for LLM

{
  "sentences": [
    {
      "text": "The Sterling Steel Factory was built in 1923.",
      "relevancy": "timeline",
      "verbs": ["built"],
      "entities": [
        {"text": "Sterling Steel Factory", "type": "ORG", "start": 4, "end": 28},
        {"text": "1923", "type": "DATE", "start": 44, "end": 48}
      ],
      "date_keywords": ["built"],
      "confidence": 0.95
    }
  ],
  "timeline_candidates": [...],
  "profile_candidates": [...],
  "stats": {...}
}
```

**Verb Categories for Relevancy:**

| Category | Verbs | Timeline Relevancy |
|----------|-------|-------------------|
| Construction | built, constructed, erected, established, founded | HIGH (build_date) |
| Opening | opened, inaugurated, launched, began operations | HIGH (opening) |
| Closure | closed, shut down, abandoned, ceased, shuttered | HIGH (closure) |
| Demolition | demolished, torn down, razed, destroyed, bulldozed | HIGH (demolition) |
| Renovation | renovated, restored, refurbished, rebuilt, expanded | MEDIUM (renovation) |
| Event | burned, flooded, collapsed, exploded, damaged | MEDIUM (event) |
| Visit | visited, explored, photographed, toured, documented | LOW (visit) |
| Publication | published, posted, wrote, updated, reported | CONTEXT (publication) |

### Phase 3: Specialized LLM Prompts

#### A. Date Extraction Agent (Enhanced)

**System Prompt:**
```
You are an archive historian extracting FACTUAL dates from documents about abandoned places.

CRITICAL RULES:
1. ONLY extract dates that have EXPLICIT VERB CONTEXT
2. A date without a verb is NOT a timeline event
3. Numbers without date context are NEVER dates (employee counts, measurements, etc.)

YOU RECEIVE: Pre-processed text with sentence classifications
YOU RETURN: Verified date extractions with verb linkage

VERB-DATE LINKAGE REQUIRED:
- "built in 1923" → VALID (verb: built, date: 1923, category: build_date)
- "1923" alone → INVALID (no verb context)
- "around 1920" → VALID only if verb present in sentence

AUDIT RULE: If you cannot identify the verb that gives the date meaning, do not extract it.
```

#### B. Entity Profile Agent (New)

**System Prompt:**
```
You are an archive researcher building mini-profiles of people and organizations mentioned in historical documents.

FOR PEOPLE:
- Full name (standardized)
- Role: owner, architect, developer, employee, founder, visitor, photographer, historian
- Date range of involvement (if stated)
- Key facts (max 3)
- Photo hint (if described in text)

FOR ORGANIZATIONS:
- Full name (standardized)
- Type: company, government, school, hospital, church, nonprofit, military
- Industry/sector
- Date range of operation (if stated)
- Relationship to location: owner, operator, tenant, builder, demolisher

AUDIT RULE: Only include facts explicitly stated in source. Never infer or assume.
```

#### C. TLDR Agent (New)

**System Prompt:**
```
You are an archivist creating timeline-optimized summaries.

TLDR FORMAT (for timeline events):
- Max 100 characters
- Focus on WHO did WHAT in WHEN
- Use past tense
- No speculation

TITLE FORMAT (for web sources):
- Max 60 characters
- Include location type if known
- Include key identifier (name, city, feature)

EXAMPLES:
- "Sterling Steel Factory operated 1923-2008 before closure due to competition"
- "Victorian mansion built circa 1885, demolished March 2010"
- "John Sterling founded automotive steel supplier, employed 500+ at peak"
```

### Phase 4: Timeline Event Enhancement

#### Current Timeline Format:
```
Date | Event | Source
```

#### Enhanced Timeline Format:
```
Date (specific) | TLDR | Sources (multi)
1923           | Built by John Sterling for automotive industry | (Source 1) (Source 2)
2008           | Closed due to foreign competition, 500 workers displaced | (Source 3)
2010-03        | Main building remains, rapid deterioration reported | (Source 4) (Source 5)
```

**Database Changes Required:**

```sql
-- Add to location_timeline table
ALTER TABLE location_timeline ADD COLUMN verb_context TEXT;
ALTER TABLE location_timeline ADD COLUMN tldr TEXT; -- Already exists
ALTER TABLE location_timeline ADD COLUMN source_refs JSON; -- Multi-source support

-- New people_profiles table
CREATE TABLE people_profiles (
  profile_id TEXT PRIMARY KEY,
  locid TEXT NOT NULL,
  full_name TEXT NOT NULL,
  normalized_name TEXT, -- For deduplication
  role TEXT,
  date_start TEXT,
  date_end TEXT,
  key_facts JSON,
  photo_hash TEXT, -- Link to imgs table
  source_refs JSON,
  confidence REAL,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (locid) REFERENCES locs(locid) ON DELETE CASCADE,
  FOREIGN KEY (photo_hash) REFERENCES imgs(imghash)
);

-- New company_profiles table
CREATE TABLE company_profiles (
  profile_id TEXT PRIMARY KEY,
  locid TEXT NOT NULL,
  full_name TEXT NOT NULL,
  normalized_name TEXT,
  org_type TEXT,
  industry TEXT,
  relationship TEXT, -- owner, operator, tenant, builder
  date_start TEXT,
  date_end TEXT,
  key_facts JSON,
  logo_hash TEXT,
  source_refs JSON,
  confidence REAL,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (locid) REFERENCES locs(locid) ON DELETE CASCADE
);
```

### Phase 5: File Structure Changes

```
packages/desktop/electron/services/extraction/
├── agents/
│   ├── prompt-templates.ts       # MODIFY: Add verb-context prompts
│   ├── date-agent.ts             # NEW: Date extraction agent
│   ├── profile-agent.ts          # NEW: People/company profiling
│   └── tldr-agent.ts             # NEW: TLDR generation
├── providers/
│   ├── base-provider.ts          # No changes
│   ├── spacy-provider.ts         # MODIFY: Add /preprocess endpoint
│   └── ollama-provider.ts        # MODIFY: Accept preprocessed input
├── preprocessing/
│   ├── verb-detector.ts          # NEW: Verb extraction and categorization
│   ├── sentence-classifier.ts    # NEW: Relevancy classification
│   └── context-builder.ts        # NEW: Build LLM input package
├── extraction-service.ts         # MODIFY: Add preprocessing step
├── extraction-queue-service.ts   # MODIFY: Handle new agent types
└── extraction-types.ts           # MODIFY: Add new types

packages/desktop/electron/python/spacy-service/
├── main.py                       # MODIFY: Add /preprocess endpoint
├── preprocessor.py               # NEW: Python preprocessing logic
└── verb_patterns.py              # NEW: Verb detection patterns
```

---

## Implementation Phases

### Phase 1: spaCy Pre-Processing (Foundation)
- [ ] Create verb detection patterns (`verb_patterns.py`)
- [ ] Add `/preprocess` endpoint to spaCy service
- [ ] Create TypeScript types for preprocessed output
- [ ] Unit tests for verb categorization

### Phase 2: Agent Prompts Overhaul
- [ ] Rewrite date extraction prompt with verb requirement
- [ ] Create entity profile agent prompt
- [ ] Create TLDR agent prompt
- [ ] Add prompt variants for Ollama vs cloud providers

### Phase 3: Pipeline Integration
- [ ] Modify extraction-service.ts to use preprocessing
- [ ] Add preprocessing step to queue service
- [ ] Create context-builder.ts
- [ ] Integration tests

### Phase 4: Database & Storage
- [ ] Create migration for people_profiles table
- [ ] Create migration for company_profiles table
- [ ] Modify location_timeline for multi-source
- [ ] Repository implementations

### Phase 5: UI Enhancements
- [ ] Enhance LocationResearchPeople.svelte for profiles
- [ ] Enhance LocationResearchCompanies.svelte for profiles
- [ ] Modify LocationResearchTimeline.svelte for multi-source
- [ ] Add profile detail modals

---

## Audit Checkpoints

### Before LLM Call:
- [ ] Text has been preprocessed by spaCy
- [ ] Only relevant sentences passed (verb-filtered)
- [ ] Entities pre-identified for validation

### After LLM Response:
- [ ] All extracted dates have verb context
- [ ] Entity names appear in source text
- [ ] Confidence scores assigned
- [ ] No hallucinated content

### Before Storage:
- [ ] Human review queue for low-confidence items
- [ ] Source references linked
- [ ] Deduplication check performed

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| spaCy preprocessing adds latency | Cache preprocessed results per source |
| Verb detection misses edge cases | Maintain expandable verb pattern list |
| LLM still hallucinates | Post-extraction validation against source text |
| Profile deduplication fails | Use normalized_name with fuzzy matching |

---

## Success Criteria

1. **Date Accuracy**: 95%+ of extracted dates have valid verb context
2. **Entity Coverage**: All named people/orgs get profile entries
3. **Source Attribution**: Every timeline event linked to 1+ sources
4. **TLDR Quality**: Timeline TLDRs readable without clicking source
5. **Performance**: Preprocessing adds <500ms to extraction pipeline

---

## Questions for Human Review

1. Should people_profiles include social links (if found in source)? **YES**
2. Should companies have logo auto-detection from web pages? **YES**
3. Priority: Timeline multi-source vs. Profile system first? **BOTH**
4. Confidence threshold for auto-approval (currently 0.85)? **KEEP 0.85**

---

## Gaps Identified (Added After Review)

### A. Missed Features

| Gap | Description | Priority |
|-----|-------------|----------|
| **Fact Conflict Detection** | Two sources claim different dates for same event (built 1920 vs 1923) | HIGH |
| **Entity Deduplication** | "John Sterling" vs "J. Sterling" vs "Sterling, John" | HIGH |
| **Cross-Location Linking** | Same person/company appears at multiple locations | MEDIUM |
| **Image-Caption Extraction** | Extract names from photo captions, link to profiles | MEDIUM |
| **Source Authority Scoring** | Historical society > blog > forum post | MEDIUM |
| **Alias/AKA Handling** | Track alternate names for people/companies | MEDIUM |
| **Timeline Event Merging** | Multiple sources saying same thing = 1 event, N sources | HIGH |
| **Historical vs Current Photos** | Distinguish archival photos for profile images | LOW |
| **Era Auto-Suggestion** | Use extracted dates to suggest location era field | LOW |
| **Location Type Inference** | Use extracted org types to suggest location_type | LOW |

### B. Social Links for People

Add to `people_profiles` table:
```sql
social_links JSON, -- {"findagrave": "url", "newspapers_com": "url", "ancestry": "url"}
```

Extraction patterns:
- Find A Grave links → obituary/death date
- Newspapers.com links → historical references
- LinkedIn (if modern) → current status
- Wikipedia → authoritative bio

### C. Logo Auto-Detection for Companies

**Detection Strategy:**
1. Look for `<img>` tags near company name mentions
2. Check for "logo" in filename, alt text, or nearby text
3. Look for favicon if company has website
4. Extract from social media og:image if company page

Add to `company_profiles` table:
```sql
logo_hash TEXT, -- Link to imgs table
logo_source TEXT, -- Where we found it
```

### D. Fact Conflict Resolution

New table for tracking conflicts:
```sql
CREATE TABLE fact_conflicts (
  conflict_id TEXT PRIMARY KEY,
  locid TEXT NOT NULL,
  conflict_type TEXT, -- 'date_mismatch', 'name_mismatch', 'fact_mismatch'
  field_name TEXT, -- 'build_date', 'founder_name', etc.

  -- The competing claims
  claim_a_value TEXT,
  claim_a_source TEXT, -- source_ref
  claim_a_confidence REAL,

  claim_b_value TEXT,
  claim_b_source TEXT,
  claim_b_confidence REAL,

  -- Resolution
  resolved INTEGER DEFAULT 0,
  resolution TEXT, -- 'claim_a', 'claim_b', 'both_valid', 'neither'
  resolution_notes TEXT,
  resolved_by TEXT,
  resolved_at TEXT,

  created_at TEXT DEFAULT (datetime('now'))
);
```

**UI Component:** "Conflicts to Resolve" badge on Research section.

### E. Entity Deduplication Strategy

**Normalized Name Algorithm:**
```python
def normalize_name(name: str) -> str:
    # "John Q. Sterling Jr." → "john sterling"
    # "Sterling, John" → "john sterling"
    # "J. Sterling" → "j sterling"

    name = name.lower().strip()
    # Remove titles: Mr., Mrs., Dr., Jr., Sr., III, etc.
    name = re.sub(r'\b(mr|mrs|ms|dr|jr|sr|i{1,3}|iv|v)\b\.?', '', name)
    # Remove middle initials
    name = re.sub(r'\b[a-z]\.\s*', '', name)
    # Handle "Last, First" format
    if ',' in name:
        parts = name.split(',')
        name = f"{parts[1].strip()} {parts[0].strip()}"
    # Collapse whitespace
    name = ' '.join(name.split())
    return name
```

**Fuzzy Match Threshold:** 85% similarity for merge suggestions.

### F. Timeline Event Merging

When multiple sources report the same event:
```
Event: Built in 1923
Sources: (Wikipedia) (Historical Society) (Local News)
```

**Merge Logic:**
1. Same date (year match for year precision, exact for exact)
2. Same category (build_date, closure, etc.)
3. Same verb context
→ Merge into single event with multiple source_refs

---

## What I Would Do Differently (Architect's Notes)

### 1. Start Smaller, Iterate Faster

**Original Plan Risk:** Too many moving parts at once. If spaCy preprocessing breaks, entire pipeline fails.

**Better Approach:**
```
Week 1: Just the verb detector + enhanced date agent
Week 2: Test on 50 real web sources, tune accuracy
Week 3: Add profile extraction if dates working well
Week 4: Add conflict detection after profiles stable
```

**Why:** Each piece needs real-world tuning. Shipping everything at once means debugging everything at once.

### 2. Use Existing Tables More

**Original Plan:** Create `people_profiles` and `company_profiles` tables.

**Alternative:** Enhance `entity_extractions` table first:
```sql
-- Already exists, just add columns:
ALTER TABLE entity_extractions ADD COLUMN profile_json TEXT; -- {key_facts, social_links, photo}
ALTER TABLE entity_extractions ADD COLUMN normalized_name TEXT;
ALTER TABLE entity_extractions ADD COLUMN aliases JSON;
ALTER TABLE entity_extractions ADD COLUMN cross_location_refs JSON; -- Other locids
```

**Why:** Fewer migrations, uses existing IPC channels, easier rollback. Create dedicated profile tables later if entity_extractions gets too complex.

### 3. Preprocessing Should Be Optional

**Original Plan:** All text goes through spaCy before LLM.

**Better Approach:** Make preprocessing a configurable step:
```typescript
interface ExtractionOptions {
  usePreprocessing: boolean; // Default: true
  preprocessingMode: 'full' | 'verbs_only' | 'entities_only';
  fallbackToRawText: boolean; // If preprocessing fails
}
```

**Why:** Some documents (like structured data, tables) may not benefit from verb filtering. User should be able to bypass if needed.

### 4. LLM Prompt Versioning

**Original Plan:** Replace existing prompts.

**Better Approach:** Version prompts and A/B test:
```typescript
const DATE_EXTRACTION_PROMPTS = {
  'v1.0': originalPrompt,      // Current
  'v2.0': verbContextPrompt,   // New with verb requirement
  'v2.1': verbContextStrict,   // Even stricter
};

// Store which version extracted each result
entity_extractions.prompt_version = 'v2.0';
```

**Why:** If v2.0 is worse for some document types, we can compare results and rollback per-document.

### 5. Conflict Detection Should Be Passive First

**Original Plan:** Detect conflicts immediately during extraction.

**Better Approach:** Background job that runs after extraction:
```typescript
// Don't block extraction with conflict checking
async function extractionComplete(locid: string) {
  // Queue conflict analysis as background job
  await jobQueue.enqueue({
    type: 'CONFLICT_DETECTION',
    locid,
    priority: 'background'
  });
}
```

**Why:** Conflict detection requires comparing against existing data. Doing it inline adds latency and complexity. Better to extract first, detect later.

### 6. Human-in-the-Loop Earlier

**Original Plan:** Auto-approve at 0.85 confidence.

**Alternative Consideration:** For profiles specifically, require human approval initially:
```typescript
const AUTO_APPROVE_THRESHOLDS = {
  date_extraction: 0.85,    // Dates can auto-approve
  entity_profile: 1.0,      // Profiles always need review initially
  tldr_generation: 0.90,    // TLDRs mostly auto-approve
};
```

**Why:** Profile data (people's names, photos, facts) is more sensitive than date extraction. A wrong date is correctable; associating wrong person with location is worse. Start conservative, loosen after confidence in system.

### 7. Source Authority Should Be User-Defined

**Original Plan:** Hardcoded authority scoring (historical society > blog).

**Better Approach:** Let user define source tiers:
```typescript
interface SourceAuthority {
  domain: string;          // "wikipedia.org"
  tier: 1 | 2 | 3 | 4;    // 1 = most authoritative
  notes: string;           // "Official encyclopedia"
}

// Default tiers (user can override):
// Tier 1: .gov, .edu, historical societies, newspapers of record
// Tier 2: Wikipedia, local news, museum sites
// Tier 3: Enthusiast sites, blogs with citations
// Tier 4: Forums, social media, uncited sources
```

**Why:** User knows their domain. A railroad enthusiast blog might be more authoritative than Wikipedia for specific rail yards.

### 8. Add Extraction Replay Capability

**Missing from original plan:**

```typescript
// Store raw extraction input for replay
CREATE TABLE extraction_inputs (
  input_id TEXT PRIMARY KEY,
  source_type TEXT,
  source_id TEXT,
  raw_text TEXT,           -- Original text
  preprocessing_json TEXT, -- spaCy output (if used)
  extraction_json TEXT,    -- LLM output
  prompt_version TEXT,
  provider TEXT,
  created_at TEXT
);
```

**Why:** When prompts improve, we can re-run extraction on historical inputs without re-fetching web pages. Critical for iterating on prompt quality.

---

## Revised Implementation Order

Based on "do differently" insights:

### Sprint 1: Foundation (Low Risk)
1. Add `normalized_name` and `profile_json` to entity_extractions
2. Create verb detection module (Python + TypeScript types)
3. Add `/preprocess` endpoint to spaCy (doesn't change main flow yet)
4. Add prompt versioning infrastructure

### Sprint 2: Integration (Medium Risk)
1. Create enhanced date extraction prompt (v2.0)
2. Wire preprocessing as OPTIONAL step in extraction service
3. A/B test v1.0 vs v2.0 on 20 real sources
4. Tune verb patterns based on results

### Sprint 3: Profiles (New Feature)
1. Create profile extraction agent
2. Add deduplication with normalized_name
3. Add alias tracking
4. Human review workflow for profiles

### Sprint 4: Polish (Enhancement)
1. Background conflict detection job
2. Source authority configuration UI
3. Timeline event merging logic
4. Extraction replay capability

### Sprint 5: Advanced (Optional)
1. Cross-location entity linking
2. Social link extraction
3. Logo auto-detection
4. Image caption extraction

---

## Final Risk Assessment

| Risk | Original Plan | Revised Approach |
|------|---------------|------------------|
| Total rewrite | HIGH (everything changes) | LOW (incremental) |
| Prompt regression | HIGH (no versioning) | LOW (A/B testing) |
| Profile errors | MEDIUM (auto-approve) | LOW (human review) |
| Pipeline latency | MEDIUM (preprocessing inline) | LOW (optional/async) |
| Rollback difficulty | HIGH (new tables) | LOW (column additions) |

---

## Decision Point

**Option A: Full Plan** - Implement everything as originally designed
- Pros: Complete solution, consistent architecture
- Cons: 4-6 week timeline, high risk, hard to rollback

**Option B: Revised Plan** - Incremental approach from "Do Differently"
- Pros: 1-2 week first value, testable in production, easy rollback
- Cons: May need refactoring later, less elegant architecture initially

**Recommendation:** Option B. Ship verb detection + enhanced prompts first. Prove value, then expand.

---

## Appendix A: Verb Patterns (Complete List)

```python
TIMELINE_VERBS = {
    'build_date': [
        'built', 'constructed', 'erected', 'established', 'founded',
        'completed', 'created', 'designed', 'developed', 'made',
        'dating from', 'dates from', 'originated'
    ],
    'opening': [
        'opened', 'inaugurated', 'launched', 'began operations',
        'started operations', 'commenced', 'debuted', 'premiered',
        'ribbon cutting', 'grand opening'
    ],
    'closure': [
        'closed', 'shut down', 'shuttered', 'abandoned', 'ceased operations',
        'stopped operations', 'went out of business', 'liquidated',
        'bankrupt', 'foreclosed'
    ],
    'demolition': [
        'demolished', 'torn down', 'razed', 'destroyed', 'bulldozed',
        'knocked down', 'leveled', 'wrecked', 'dismantled'
    ],
    'renovation': [
        'renovated', 'restored', 'refurbished', 'rebuilt', 'expanded',
        'remodeled', 'upgraded', 'modernized', 'repaired', 'improved'
    ],
    'event': [
        'burned', 'flooded', 'collapsed', 'exploded', 'damaged',
        'fire', 'explosion', 'accident', 'incident', 'disaster',
        'struck', 'hit', 'destroyed by'
    ],
    'visit': [
        'visited', 'explored', 'photographed', 'toured', 'documented',
        'discovered', 'found', 'stumbled upon', 'came across'
    ],
    'publication': [
        'published', 'posted', 'wrote', 'updated', 'reported',
        'documented', 'recorded', 'noted', 'mentioned'
    ]
}
```

---

## Appendix B: Sample Preprocessed Output

**Input Text:**
```
The Sterling Steel Factory was built in 1923 by John Sterling. At its peak,
it employed 500 workers. The factory closed in 2008 due to foreign competition
and has sat abandoned since. I visited the site in March 2024.
```

**Preprocessed Output:**
```json
{
  "document_stats": {
    "total_sentences": 4,
    "timeline_relevant": 3,
    "profile_relevant": 1
  },
  "sentences": [
    {
      "text": "The Sterling Steel Factory was built in 1923 by John Sterling.",
      "relevancy": "timeline",
      "relevancy_type": "build_date",
      "verbs": [{"text": "built", "category": "build_date", "pos": 35}],
      "entities": [
        {"text": "Sterling Steel Factory", "type": "ORG", "start": 4, "end": 26},
        {"text": "1923", "type": "DATE", "start": 43, "end": 47},
        {"text": "John Sterling", "type": "PERSON", "start": 51, "end": 64}
      ],
      "confidence": 0.95
    },
    {
      "text": "At its peak, it employed 500 workers.",
      "relevancy": "context",
      "relevancy_type": null,
      "verbs": [{"text": "employed", "category": null, "pos": 15}],
      "entities": [],
      "confidence": 0.3,
      "note": "500 workers is employee count, not date"
    },
    {
      "text": "The factory closed in 2008 due to foreign competition and has sat abandoned since.",
      "relevancy": "timeline",
      "relevancy_type": "closure",
      "verbs": [
        {"text": "closed", "category": "closure", "pos": 12},
        {"text": "abandoned", "category": "closure", "pos": 62}
      ],
      "entities": [
        {"text": "2008", "type": "DATE", "start": 22, "end": 26}
      ],
      "confidence": 0.92
    },
    {
      "text": "I visited the site in March 2024.",
      "relevancy": "timeline",
      "relevancy_type": "visit",
      "verbs": [{"text": "visited", "category": "visit", "pos": 2}],
      "entities": [
        {"text": "March 2024", "type": "DATE", "start": 22, "end": 32}
      ],
      "confidence": 0.88
    }
  ],
  "profile_candidates": {
    "people": [
      {
        "name": "John Sterling",
        "context": "The Sterling Steel Factory was built in 1923 by John Sterling.",
        "implied_role": "founder"
      }
    ],
    "organizations": [
      {
        "name": "Sterling Steel Factory",
        "contexts": [
          "The Sterling Steel Factory was built in 1923 by John Sterling.",
          "The factory closed in 2008 due to foreign competition..."
        ],
        "implied_type": "company"
      }
    ]
  },
  "filtered_dates": {
    "included": ["1923", "2008", "March 2024"],
    "excluded": ["500 workers (employee count, not date)"]
  }
}
```

---

**END OF PLAN - AWAITING HUMAN REVIEW**
