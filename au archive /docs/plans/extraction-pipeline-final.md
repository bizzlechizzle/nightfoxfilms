# Extraction Pipeline: Archive Tool

**Purpose:** Validate ingested data. Make it readable. Catalog it.

**LLM Role:** Background worker. Explicit tasks only. No interaction.

---

## SCOPE: WHAT WE'RE BUILDING

### YES (In Scope)
- Auto-extract dates, people, companies from web sources
- Auto-generate clean titles (60 chars max)
- Auto-generate TL;DR summaries (2 sentences)
- Auto-tag location type (golf course, factory, etc.)
- Display extracted data cleanly on location page
- Show sources with attribution
- Human review queue for low-confidence extractions

### NO (Out of Scope)
- ~~Interactive LLM queries~~
- ~~Network graph visualization~~
- ~~Trend analysis~~
- ~~Predictive suggestions~~
- ~~"Ask the archive" features~~
- ~~Spider web UI~~

---

## LLM TASKS (Explicit, Background Only)

The LLM does exactly 4 things. Nothing else.

### Task 1: Extract Dates
```
INPUT:  Raw text from web source
OUTPUT: JSON array of dates with categories
TRIGGER: Web source saved
RUNS: Background queue
```

### Task 2: Extract Entities
```
INPUT:  Raw text from web source
OUTPUT: JSON array of people/companies with roles
TRIGGER: Web source saved
RUNS: Background queue
```

### Task 3: Generate Title
```
INPUT:  Raw text (first 2000 chars)
OUTPUT: Clean title, max 60 chars
TRIGGER: Web source saved
RUNS: Background queue
```

### Task 4: Generate Summary
```
INPUT:  Raw text from web source
OUTPUT: 2-sentence TL;DR
TRIGGER: Web source saved
RUNS: Background queue
```

**That's it. No other LLM tasks.**

---

## AUTO-TAGS (Simple, Explicit)

### Location Type (ONE tag, required)
```
golf-course | factory | hospital | school | church | theater |
hotel | mall | prison | asylum | military | resort | power-plant |
warehouse | office | residential | farm | mine | other
```

### Era (ONE tag, based on build year)
```
pre-1900 | 1900-1930 | 1930-1960 | 1960-1990 | 1990-present
```

### Status (ONE tag, current state)
```
abandoned | demolished | renovated | active | unknown
```

**No feature tags. No access tags. Keep it simple.**

---

## DATABASE CHANGES

```sql
-- Add to web_sources
ALTER TABLE web_sources ADD COLUMN smart_title TEXT;
ALTER TABLE web_sources ADD COLUMN smart_summary TEXT;
ALTER TABLE web_sources ADD COLUMN extraction_status TEXT DEFAULT 'pending';
ALTER TABLE web_sources ADD COLUMN extraction_confidence REAL;

-- Add to locs
ALTER TABLE locs ADD COLUMN location_type TEXT;
ALTER TABLE locs ADD COLUMN era TEXT;
ALTER TABLE locs ADD COLUMN status TEXT DEFAULT 'abandoned';

-- Simple entity storage (no graph, just list)
CREATE TABLE extracted_entities (
  entity_id TEXT PRIMARY KEY,
  source_id TEXT REFERENCES web_sources(source_id),
  locid TEXT REFERENCES locs(locid),
  entity_type TEXT NOT NULL,  -- 'person' or 'organization'
  name TEXT NOT NULL,
  role TEXT,  -- 'owner', 'architect', 'developer', etc.
  date_range TEXT,  -- '2006-2016'
  confidence REAL DEFAULT 0.5,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Enhanced timeline
ALTER TABLE location_timeline ADD COLUMN smart_title TEXT;
ALTER TABLE location_timeline ADD COLUMN tldr TEXT;
ALTER TABLE location_timeline ADD COLUMN confidence REAL;
ALTER TABLE location_timeline ADD COLUMN needs_review INTEGER DEFAULT 0;
```

---

## UI: LOCATION PAGE

### Sources Section (Updated)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  SOURCES                                                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Syracuse Housing Project Targets Micron Workers                    │   │
│  │                                                                     │   │
│  │  California developer plans 300-home resort community at former    │   │
│  │  Lafayette Hills country club, targeting Micron employees.         │   │
│  │                                                                     │   │
│  │  syracuse.com  •  Apr 2025  •  Rick Moriarty                       │   │
│  │                                                                     │   │
│  │  Dates: 2013 (closure), 2023 (purchase)                            │   │
│  │  People: Kassie Smith (developer), Mike Muraco (investor)          │   │
│  │  Companies: KS Global, B3R Investments, Micron                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Energy Glass Factory Proposed for Abandoned Course                 │   │
│  │                                                                     │   │
│  │  Florida's Saf-Glas considers closed golf club for nano-particle   │   │
│  │  glass manufacturing, promising 110-130 initial jobs.              │   │
│  │                                                                     │   │
│  │  syracuse.com  •  May 2017  •  Rick Moriarty                       │   │
│  │                                                                     │   │
│  │  Dates: 2006 (purchase), 2013 (closure), 2016 (transfer)           │   │
│  │  People: Arthur Marino Jr. (Saf-Glas), Mike Muraco (investor)      │   │
│  │  Companies: Saf-Glas LLC, Empire State Development                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Timeline Section (Updated)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  TIMELINE                                                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1923  ESTABLISHED                                                          │
│        LaFayette Hills Golf & Country Club Founded                          │
│        18-hole course designed by Seymour Dunn, par 71.                    │
│        Source: Abandoned Upstate                                            │
│                                                                             │
│  2006  PURCHASED                                                            │
│        Mike Muraco Acquires Property                                        │
│        Real estate investor purchases for $2.4M.                           │
│        Source: Syracuse.com                                                 │
│                                                                             │
│  2013  CLOSED                                                               │
│        Country Club Permanently Closes                                      │
│        Membership declined to zero. Tax disputes cited.                    │
│        Sources: Abandoned Upstate, Syracuse.com                            │
│                                                                             │
│  2023  PURCHASED                                                            │
│        B3R Investments Buys Property                                        │
│        Texas firm purchases for $3M.                                       │
│        Source: Syracuse.com                                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### People & Companies Section (Simple List)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PEOPLE & COMPANIES                                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PEOPLE                                                                     │
│                                                                             │
│  Seymour Dunn              Architect           1923                         │
│  Mike Muraco               Owner               2006-2016                    │
│  Kassie Smith              Developer           2025-                        │
│  Arthur Marino Jr.         Proposed tenant     2017                         │
│                                                                             │
│  COMPANIES                                                                  │
│                                                                             │
│  LaFayette Hills G&CC      Original operator   1923-2013                    │
│  Royal Holdings DE LLC     Owner               2016-2023                    │
│  B3R Investments           Current owner       2023-                        │
│  Saf-Glas LLC              Proposed tenant     2017 (did not proceed)       │
│  KS Global Development     Developer           2025-                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Tags Display (Simple)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                      │
│  │ GOLF COURSE  │  │  1900-1930   │  │  ABANDONED   │                      │
│  └──────────────┘  └──────────────┘  └──────────────┘                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## EXTRACTION QUEUE (Background)

```typescript
// Triggered when web source is saved
async function onWebSourceSaved(source: WebSource) {
  // Add to background queue - does NOT block UI
  extractionQueue.add({
    sourceId: source.source_id,
    locid: source.locid,
    tasks: ['dates', 'entities', 'title', 'summary']
  });
}

// Background worker processes queue
async function processExtractionJob(job: ExtractionJob) {
  const text = await getSourceText(job.sourceId);

  // Run all 4 tasks
  const [dates, entities, title, summary] = await Promise.all([
    extractDates(text),
    extractEntities(text),
    generateTitle(text),
    generateSummary(text)
  ]);

  // Save results
  await saveExtractionResults(job.sourceId, {
    dates,
    entities,
    smart_title: title,
    smart_summary: summary,
    extraction_status: 'complete'
  });

  // Create timeline events from high-confidence dates
  for (const date of dates.filter(d => d.confidence > 0.8)) {
    await createTimelineEvent(job.locid, date);
  }
}
```

---

## QUALITY CHECKS (Built-In)

### Date Validation
```typescript
const DATE_RULES = {
  yearRange: [1800, 2100],
  rejectPatterns: [
    /\d+ to \d+/,      // "110 to 130"
    /\$[\d,]+/,        // Currency
    /\d+:\d+/,         // Times
  ],
  requireContext: true,
  minConfidence: 0.5
};
```

### Entity Validation
```typescript
const ENTITY_RULES = {
  minNameLength: 2,
  maxNameLength: 100,
  rejectPatterns: [
    /^[0-9]+$/,        // Pure numbers
    /^https?:\/\//,    // URLs
  ]
};
```

### Auto-Approve vs Review
```typescript
// Auto-approve: confidence > 0.85, has keyword context
// Needs review: confidence 0.5-0.85
// Auto-reject: confidence < 0.5
```

---

## IMPLEMENTATION: 3 PHASES

### Phase 1: Core Extraction (3 days)
```
□ extraction-queue.ts - Background job queue
□ date-extractor.ts - Extract dates from text
□ entity-extractor.ts - Extract people/companies
□ title-generator.ts - Generate clean titles
□ summary-generator.ts - Generate TL;DR
□ Database migrations
□ Auto-trigger on web source save
```

### Phase 2: Display (2 days)
```
□ Update SourceCard.svelte - Show smart title, summary, extracted data
□ Update Timeline.svelte - Show smart titles, TL;DR, sources
□ Add PeopleCompanies.svelte - Simple list display
□ Add Tags display to location header
```

### Phase 3: Auto-Tagging (1 day)
```
□ location-tagger.ts - Detect type from text
□ era-detector.ts - Detect era from dates
□ Update locs table with tags
□ Filter by tags on Locations page
```

---

## WHAT SUCCESS LOOKS LIKE

| Before | After |
|--------|-------|
| Verbose 90-char titles | Clean 60-char titles |
| No summaries | 2-sentence TL;DR on every source |
| Dates scattered in text | Timeline with smart titles |
| No entity tracking | People & Companies list |
| Manual tagging | Auto-tagged type, era, status |
| No source attribution | Every fact links to source |

---

## WHAT WE'RE NOT BUILDING

- ~~Interactive LLM chat~~
- ~~"Ask the archive"~~
- ~~Network visualization~~
- ~~Trend analysis~~
- ~~Predictive features~~
- ~~Entity relationship graphs~~

This is an archive. It ingests, validates, catalogs, displays. That's it.

---

*Document Version: 2.0 (Simplified)*
*Last Updated: 2025-12-13*
