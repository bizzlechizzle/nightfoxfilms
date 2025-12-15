# Timeline Feature Plan

**Feature:** Timeline Box for Location & Sub-Location Pages
**Status:** APPROVED - Implementation In Progress
**Created:** 2025-12-11
**Updated:** 2025-12-11 (v2 - Added gaps, fixes, implementation guide)

---

## Overview

Add a Timeline section to location and sub-location detail pages, replacing the Information box's current position. The Information box moves below and becomes horizontal.

---

## Layout Changes

### Current Layout (lines 1178-1210 of LocationDetail.svelte)
```
┌─────────────────────────────────────────────────────────────┐
│                    Index Card Header                        │
├─────────────────────────────────────────────────────────────┤
│  LocationInfo (55%)    │    LocationMapSection (45%)        │
│  - AKA Names           │    - Address                       │
│  - Status + Category   │    - GPS                           │
│  - Built/Abandoned     │    - Mini Map                      │
│  - Documentation       │    - Local Region                  │
│  - Flags               │    - Region                        │
│  - Authors             │                                    │
├─────────────────────────────────────────────────────────────┤
│                    Sub-Location Grid                        │
├─────────────────────────────────────────────────────────────┤
│                         Notes                               │
│                      Import Zone                            │
│                      Web Sources                            │
│                     Media Gallery                           │
└─────────────────────────────────────────────────────────────┘
```

### New Layout
```
┌─────────────────────────────────────────────────────────────┐
│                    Index Card Header                        │
├─────────────────────────────────────────────────────────────┤
│  NEW: Timeline (55%)   │    LocationMapSection (45%)        │
│  - Established Date    │    - Address                       │
│  - Visit Dates         │    - GPS                           │
│  - Database Entry      │    - Mini Map                      │
│                        │    - Local Region                  │
│                        │    - Region                        │
├─────────────────────────────────────────────────────────────┤
│                LocationInfo (horizontal, full width)        │
│  [AKA] [Status] [Category] [Built/Abandoned] [Flags] [Docs] │
├─────────────────────────────────────────────────────────────┤
│                    Sub-Location Grid                        │
│                         Notes                               │
│                      Import Zone                            │
│                      Web Sources                            │
│                     Media Gallery                           │
└─────────────────────────────────────────────────────────────┘
```

---

## Timeline Data Model

### New Table: `location_timeline`

```sql
CREATE TABLE IF NOT EXISTS location_timeline (
  event_id TEXT PRIMARY KEY,           -- BLAKE3 16-char hash
  locid TEXT NOT NULL REFERENCES locs(locid) ON DELETE CASCADE,
  subid TEXT REFERENCES slocs(subid) ON DELETE CASCADE,

  -- Event type
  event_type TEXT NOT NULL,            -- 'established' | 'visit' | 'database_entry' | 'custom'
  event_subtype TEXT,                  -- For established: 'built'|'opened'|'expanded'|'renovated'|'closed'|'abandoned'|'demolished'

  -- Date information (flexible precision)
  date_start TEXT,                     -- ISO 8601 or partial (e.g., "1920", "1920-03")
  date_end TEXT,                       -- For ranges (e.g., "1925")
  date_precision TEXT NOT NULL,        -- See precision types below
  date_display TEXT,                   -- Human-readable: "March 1920", "1920s", "19th Century"
  date_edtf TEXT,                      -- EDTF format for archival export (e.g., "1920~", "1920/1925")
  date_sort INTEGER,                   -- Sortable YYYYMMDD for ordering (19200101 for decade start)

  -- Override for wrong EXIF dates
  date_override TEXT,                  -- Corrected date if EXIF was wrong
  override_reason TEXT,                -- Why override was needed

  -- Source tracking
  source_type TEXT,                    -- 'exif' | 'manual' | 'web' | 'document'
  source_ref TEXT,                     -- imghash/vidhash for EXIF, URL for web
  source_device TEXT,                  -- Camera make/model from EXIF

  -- Visit consolidation (for event_type = 'visit')
  media_count INTEGER DEFAULT 0,       -- Number of media files in this visit
  media_hashes TEXT,                   -- JSON array of imghash/vidhash values

  -- Verification
  auto_approved INTEGER DEFAULT 0,     -- 1 if cellphone (auto-trusted)
  user_approved INTEGER DEFAULT 0,     -- 1 if user verified
  approved_at TEXT,                    -- ISO timestamp
  approved_by TEXT,                    -- user_id

  -- Audit trail
  notes TEXT,                          -- User notes for this event
  created_at TEXT NOT NULL,            -- ISO timestamp
  created_by TEXT,                     -- user_id who created
  updated_at TEXT,                     -- ISO timestamp
  updated_by TEXT                      -- user_id who last modified
);

CREATE INDEX IF NOT EXISTS idx_timeline_locid ON location_timeline(locid);
CREATE INDEX IF NOT EXISTS idx_timeline_subid ON location_timeline(subid);
CREATE INDEX IF NOT EXISTS idx_timeline_type ON location_timeline(event_type);
CREATE INDEX IF NOT EXISTS idx_timeline_date ON location_timeline(date_sort);
```

### Date Precision Enum

```typescript
type DatePrecision =
  // Exact precision
  | 'exact'      // Full date: 2024-03-15
  | 'month'      // Month only: 2024-03
  | 'year'       // Year only: 2024
  // Reduced precision
  | 'decade'     // 1920s
  | 'century'    // 19th Century
  // Approximation
  | 'circa'      // ca. 1950
  // Ranges
  | 'range'      // 1920-1925
  | 'before'     // before 1950
  | 'after'      // after 1945
  // Relative temporal
  | 'early'      // early 1900s
  | 'mid'        // mid-1950s
  | 'late'       // late 1980s
  // Unknown
  | 'unknown';   // No date information
```

### Event Types

| Type | Description | Source |
|------|-------------|--------|
| `established` | When place was built/opened/closed | Manual or web citation |
| `visit` | User visit date | EXIF from images/videos |
| `database_entry` | When added to archive | Automatic (locadd) |
| `custom` | User-defined events | Manual entry |

### Established Subtypes

| Subtype | Description | Use Case |
|---------|-------------|----------|
| `built` | Construction completed | Original construction |
| `opened` | Opened to public/operations | Businesses, institutions |
| `expanded` | Major expansion/addition | New wings, buildings |
| `renovated` | Major renovation | Significant changes |
| `closed` | Operations ceased | Businesses, institutions |
| `abandoned` | Left vacant | Primary use case |
| `demolished` | Structure removed | Historical record |

### Date Precision Types (Archival Standards)

Based on EDTF (Library of Congress), EAD, DACS, and museum cataloging standards:

| Precision | date_start | date_end | date_display | date_sort | Use Case |
|-----------|------------|----------|--------------|-----------|----------|
| `exact` | 2024-03-15 | null | "March 15, 2024" | 20240315 | EXIF dates |
| `month` | 2024-03 | null | "March 2024" | 20240301 | Partial memory |
| `year` | 2024 | null | "2024" | 20240101 | Known year |
| `decade` | 1920 | null | "1920s" | 19200101 | Approximate era |
| `century` | 19 | null | "19th Century" | 18010101 | Very old sites |
| `circa` | 1950 | null | "ca. 1950" | 19500101 | Approximate single year |
| `range` | 1920 | 1925 | "1920-1925" | 19200101 | Construction period |
| `before` | null | 1950 | "before 1950" | 19500101 | Upper bound only |
| `after` | 1945 | null | "after 1945" | 19450101 | Lower bound only |
| `early` | 1900 | null | "early 1900s" | 19000101 | First third |
| `mid` | 1950 | null | "mid-1950s" | 19500101 | Middle third |
| `late` | 1980 | null | "late 1980s" | 19800101 | Last third |
| `unknown` | null | null | "unknown" | 99999999 | No information |

### EDTF Storage (Future Export Compatibility)

Store machine-readable EDTF format for archival interoperability:
- Uncertain: `1984?`
- Approximate: `1984~`
- Range: `1920/1925`
- Before: `../1950`
- After: `1945/..`
- Decade: `192X`

---

## Cellphone vs Camera Detection

### Auto-Approved Devices (Cellphones)
Phones sync time automatically. Look for these patterns in `meta_camera_make`:

```typescript
const CELLPHONE_MAKES = [
  'apple', 'samsung', 'google', 'pixel', 'oneplus', 'xiaomi',
  'huawei', 'oppo', 'vivo', 'motorola', 'lg', 'sony mobile',
  'htc', 'nokia', 'realme', 'poco', 'asus rog'
];

function isCellphone(make: string | null, model: string | null): boolean {
  if (!make) return false;
  const makeLower = make.toLowerCase();
  return CELLPHONE_MAKES.some(m => makeLower.includes(m)) ||
         (model?.toLowerCase().includes('iphone') ?? false) ||
         (model?.toLowerCase().includes('galaxy') ?? false) ||
         (model?.toLowerCase().includes('pixel') ?? false);
}
```

### Manual Verification Required
- DSLR cameras (Canon, Nikon, Sony Alpha, etc.)
- Drones (DJI, etc.)
- Action cameras (GoPro)
- Film scanners
- Unknown devices

---

## Timeline Component Design (Braun-Compliant)

### Visual Structure

```
┌─────────────────────────────────────────────────────────────┐
│ TIMELINE                                          [edit]    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ○ Established                                              │
│  │ —                                                        │
│  │                                                          │
│  ● March 15, 2024                                   [EXIF]  │
│  │ Visit • iPhone 15 Pro                            ✓       │
│  │                                                          │
│  ● September 3, 2023                                [EXIF]  │
│  │ Visit • Canon EOS R5                             ○       │
│  │                                                          │
│  ○ December 11, 2025                                        │
│    Database Entry                                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Visual Elements

| Element | Description | Style |
|---------|-------------|-------|
| Timeline line | Vertical connector | 1px `border-braun-300` |
| Event dot (approved) | Filled circle | 8px `bg-braun-900` |
| Event dot (pending) | Empty circle | 8px `border-braun-400` |
| Date | Primary text | 15px `text-braun-900` font-medium |
| Event type | Secondary text | 13px `text-braun-600` |
| Device | Tertiary text | 13px `text-braun-500` |
| Source badge | [EXIF] tag | 11px uppercase `text-braun-500` |
| Approval indicator | ✓ or ○ | 13px `text-braun-500` |

### Date Input UI (Braun Approach)

**Philosophy**: "Start with what you know. Never force false precision."

The date input uses **progressive disclosure** - a single field that adapts based on what the user types or selects. No mode switching, no hidden states.

#### Primary Input: Smart Text Field

```
┌─────────────────────────────────────────────────────────────┐
│ ESTABLISHED DATE                                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 1920s                                            ▼  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Interpreted as: decade (1920-1929)                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### Input Recognition Patterns

The field auto-detects precision from natural input:

| User Types | Detected As | Display |
|------------|-------------|---------|
| `1920` | year | "1920" |
| `1920s` | decade | "1920s" |
| `1920-1925` | range | "1920-1925" |
| `ca 1920` or `circa 1920` | circa | "ca. 1920" |
| `~1920` | circa | "ca. 1920" |
| `early 1900s` | early+decade | "early 1900s" |
| `mid 1950s` | mid+decade | "mid-1950s" |
| `late 1800s` | late+decade | "late 1800s" |
| `19th century` | century | "19th Century" |
| `before 1950` | before | "before 1950" |
| `after 1945` | after | "after 1945" |
| `March 2024` | month | "March 2024" |
| `3/15/2024` or `2024-03-15` | exact | "March 15, 2024" |
| (empty) | unknown | "—" |

#### Dropdown Override

A dropdown arrow (▼) provides explicit selection when auto-detect isn't sufficient:

```
┌─────────────────────────────────────────────────────────────┐
│  ┌───────────────────────────────────┬─────────────────┐   │
│  │ 1920                              │  Year        ▼  │   │
│  └───────────────────────────────────┴─────────────────┘   │
│                                      ┌─────────────────┐   │
│                                      │ Exact Date      │   │
│                                      │ Month           │   │
│                                      │ Year         ●  │   │
│                                      │ Decade          │   │
│                                      │ Century         │   │
│                                      │ ───────────     │   │
│                                      │ Circa (approx)  │   │
│                                      │ Range           │   │
│                                      │ Before          │   │
│                                      │ After           │   │
│                                      │ ───────────     │   │
│                                      │ Early period    │   │
│                                      │ Mid period      │   │
│                                      │ Late period     │   │
│                                      │ ───────────     │   │
│                                      │ Unknown         │   │
│                                      └─────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

#### Range Input (When Selected)

Selecting "Range" reveals a second field:

```
┌─────────────────────────────────────────────────────────────┐
│  ┌─────────────────┐  to  ┌─────────────────┐              │
│  │ 1920            │      │ 1925            │   Range      │
│  └─────────────────┘      └─────────────────┘              │
│                                                             │
│  Interpreted as: 1920-1925                                 │
└─────────────────────────────────────────────────────────────┘
```

#### Feedback Line

Always show interpretation below input (Braun: honest, self-explanatory):

```css
.date-feedback {
  font-size: 13px;
  color: #8A8A86;  /* text-braun-500 */
  margin-top: 4px;
}
```

### Empty State UI

New location with no visits yet:

```
┌─────────────────────────────────────────────────────────────┐
│ TIMELINE                                          [edit]    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ○ Established                                              │
│  │ —                                        [add date]      │
│  │                                                          │
│  ○ December 11, 2025                                        │
│    Added to archive                                         │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Import media to automatically detect visit dates    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Edit Mode (Accordion)

When "edit" clicked, expand to show:

```
┌─────────────────────────────────────────────────────────────┐
│ TIMELINE                                        [collapse]  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ▼ Established                                    [+ add]   │
│  │ ┌─────────────────────────────────────────────────────┐ │
│  │ │ [early 1900s                               ] Year ▼ │ │
│  │ │ Interpreted as: early 1900s (1900-1933)             │ │
│  │ │                                                      │ │
│  │ │ Notes: [________________________]                   │ │
│  │ │                               [Save] [Cancel]       │ │
│  │ └─────────────────────────────────────────────────────┘ │
│  │                                                          │
│  ▼ Visit • March 15, 2024                         [verify]  │
│  │ Source: IMG_1234.jpg                                    │
│  │ Device: iPhone 15 Pro                                   │
│  │ Status: Auto-approved (cellphone)               ✓       │
│  │                                                          │
│  ▼ Visit • September 3, 2023                      [verify]  │
│  │ Source: DSC_0042.NEF                                    │
│  │ Device: Canon EOS R5                                    │
│  │ Status: Pending verification                    [✓]     │
│  │                                                          │
│  ○ Database Entry • December 11, 2025              (auto)   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Visit Consolidation

Multiple photos from the same calendar day consolidate into one visit entry:

```
┌─────────────────────────────────────────────────────────────┐
│  ● March 15, 2024                              [EXIF] ✓    │
│  │ Visit • 12 photos, 2 videos                             │
│  │ Devices: iPhone 15 Pro                                  │
└─────────────────────────────────────────────────────────────┘
```

Clicking expands to show individual files if needed.

### Long Timeline Collapse

For locations with many visits, collapse older entries:

```
┌─────────────────────────────────────────────────────────────┐
│  ● March 15, 2024                              [EXIF] ✓    │
│  │ Visit • 12 photos                                       │
│  │                                                          │
│  ● January 8, 2024                             [EXIF] ✓    │
│  │ Visit • 4 photos                                        │
│  │                                                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ▶ Show 23 earlier visits (2019-2023)                │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ○ December 11, 2025                                        │
│    Added to archive                                         │
└─────────────────────────────────────────────────────────────┘
```

---

## Horizontal Information Box Redesign

Move LocationInfo below the Timeline/Map row, display as horizontal card groups:

```
┌─────────────────────────────────────────────────────────────┐
│ INFORMATION                                        [edit]   │
├─────────────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌────────────┐ ┌──────────────┐ ┌───────────┐ │
│ │ AKA      │ │ Status     │ │ Category     │ │ Built     │ │
│ │ Old Mill │ │ Abandoned  │ │ Industrial   │ │ 1920      │ │
│ │ The Mill │ │            │ │ Mill         │ │           │ │
│ └──────────┘ └────────────┘ └──────────────┘ └───────────┘ │
│ ┌──────────────────┐ ┌──────────────────────────────────┐  │
│ │ Documentation    │ │ Flags                            │  │
│ │ ● Interior       │ │ ★ Favorite  📜 Historic          │  │
│ │ ● Exterior       │ │                                  │  │
│ │ ○ Drone          │ └──────────────────────────────────┘  │
│ └──────────────────┘                                        │
└─────────────────────────────────────────────────────────────┘
```

### Card Group Styling (Braun)

- Background: `bg-braun-50` for card groups
- Border: `border border-braun-200`
- Border radius: `4px` (consistent)
- Padding: `12px 16px`
- Gap between groups: `16px` (8pt grid)
- Label: 11px uppercase `text-braun-500` 0.1em letter-spacing
- Value: 15px `text-braun-900`

---

## Decisions (Answered)

1. **Sub-location timelines**: ✅ **Independent + Inherited**
   - Sub-locations have their own independent timelines
   - Host location timeline is independent AND displays inherited events from all sub-locations
   - Display shows source: "from [Building Name]" for inherited events

2. **Established date format**: ✅ **Smart text field with auto-detection**
   - Single input field recognizes natural patterns (1920s, ca. 1920, early 1900s, etc.)
   - Dropdown override for explicit precision selection
   - Feedback line shows interpretation (Braun: honest, self-explanatory)

3. **Visit consolidation**: ✅ **Consolidate by calendar day**
   - Multiple photos from same day = single visit entry
   - Shows count: "Visit • 12 photos, 2 videos"
   - Expandable to see individual files

4. **Edit permissions**: ✅ **Any user can edit**
   - All timeline events editable by any authenticated user
   - Audit trail tracks who made changes

5. **Built/Abandoned vs Timeline**: ✅ **Both exist, different purposes**
   - Built/Abandoned stays in Info box as "at a glance" summary
   - Timeline tells full story with sources, precision, and audit trail

6. **Sorting**: ✅ **date_sort INTEGER column**
   - Store sortable YYYYMMDD value
   - Handles mixed precision (decade vs exact date)

7. **Wrong EXIF dates**: ✅ **Override capability**
   - date_override and override_reason columns
   - User can correct camera clock errors

8. **Timezone**: ✅ **Store as-is (local time)**
   - Don't normalize to UTC (false precision)
   - Display without timezone indicator

---

## Host Location Timeline Inheritance

When viewing a host location, the timeline shows:

```
┌─────────────────────────────────────────────────────────────┐
│ TIMELINE                                          [edit]    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ○ Established                                              │
│  │ early 1900s                                              │
│  │                                                          │
│  ● March 15, 2024                              [EXIF] ✓    │
│  │ Visit • Main Building                                   │
│  │ 8 photos • iPhone 15 Pro                                │
│  │                                                          │
│  ● March 15, 2024                              [EXIF] ✓    │
│  │ Visit • Power House          ← from sub-location        │
│  │ 4 photos • iPhone 15 Pro                                │
│  │                                                          │
│  ● September 3, 2023                           [EXIF] ○    │
│  │ Visit • Campus-level                                    │
│  │ 2 photos • Canon EOS R5                                 │
│  │                                                          │
│  ○ December 11, 2025                                        │
│    Database Entry                                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Inheritance Rules

| Viewing | Shows |
|---------|-------|
| Host location | Host timeline + all sub-location timelines (labeled) |
| Sub-location | Sub-location timeline only |

### Query Pattern

```sql
-- Get combined timeline for host location
SELECT t.*, NULL as source_building
FROM location_timeline t
WHERE t.locid = ? AND t.subid IS NULL
UNION ALL
SELECT t.*, s.subnam as source_building
FROM location_timeline t
JOIN slocs s ON t.subid = s.subid
WHERE t.locid = ?
ORDER BY date_sort DESC;
```

---

## Implementation Phases

### Phase 1: Database & Types (Migration 68)

1. Add `location_timeline` table with all columns
2. Add TypeScript types in `database.types.ts`
3. Add Zod schema in `packages/core/src/domain/timeline.ts`

### Phase 2: Repository Layer

1. Create `sqlite-timeline-repository.ts`
2. Methods: `findByLocation`, `findBySubLocation`, `findCombined`, `create`, `update`, `delete`, `approve`, `addMediaToVisit`, `removeMediaFromVisit`
3. Visit deduplication logic (check existing visits for same date)

### Phase 3: Service Layer

1. Create `timeline-service.ts` in `electron/services/`
2. Create `date-parser-service.ts` with smart text recognition
3. Cellphone detection logic
4. Visit consolidation by calendar day
5. date_sort calculation

### Phase 4: IPC Handlers

1. Create `timeline-handlers.ts`
2. Channels: `timeline:findByLocation`, `timeline:findCombined`, `timeline:create`, `timeline:update`, `timeline:delete`, `timeline:approve`, `timeline:parseDate`
3. Add to preload bridge

### Phase 5: UI Components

1. Create `LocationTimeline.svelte` (main timeline display)
2. Create `TimelineEditModal.svelte` (edit/verify interface)
3. Create `TimelineEvent.svelte` (individual event row)
4. Create `TimelineDateInput.svelte` (smart date input field)

### Phase 6: Layout Refactor

1. Update `LocationDetail.svelte` layout grid
2. Create `LocationInfoHorizontal.svelte` (new horizontal layout)
3. Apply same changes to sub-location view

### Phase 7: Integration

1. Auto-generate visit events on media import (in file-import-service.ts)
2. Auto-create established event (blank) for new locations
3. Auto-create database_entry event from locadd
4. Handle media deletion (update visit media_count)

---

## Data Migration

For existing locations:

```typescript
// Migration 68: Backfill timeline events
function backfillTimeline(db: Database) {
  // 1. Create database_entry events from locadd
  db.exec(`
    INSERT INTO location_timeline (
      event_id, locid, event_type, date_start, date_precision,
      date_display, date_sort, source_type, created_at
    )
    SELECT
      lower(hex(randomblob(8))),
      locid,
      'database_entry',
      locadd,
      'exact',
      locadd,
      CAST(strftime('%Y%m%d', locadd) AS INTEGER),
      'system',
      datetime('now')
    FROM locs
    WHERE locadd IS NOT NULL
  `);

  // 2. Create blank established events for all locations
  db.exec(`
    INSERT INTO location_timeline (
      event_id, locid, event_type, event_subtype, date_precision,
      date_display, date_sort, source_type, created_at
    )
    SELECT
      lower(hex(randomblob(8))),
      locid,
      'established',
      'built',
      'unknown',
      '—',
      99999999,
      'manual',
      datetime('now')
    FROM locs
  `);

  // 3. Create blank established events for all sub-locations
  db.exec(`
    INSERT INTO location_timeline (
      event_id, locid, subid, event_type, event_subtype, date_precision,
      date_display, date_sort, source_type, created_at
    )
    SELECT
      lower(hex(randomblob(8))),
      locid,
      subid,
      'established',
      'built',
      'unknown',
      '—',
      99999999,
      'manual',
      datetime('now')
    FROM slocs
  `);
}
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `packages/core/src/domain/timeline.ts` | Timeline domain types + Zod schemas |
| `packages/desktop/electron/repositories/sqlite-timeline-repository.ts` | Timeline data access |
| `packages/desktop/electron/services/timeline-service.ts` | Business logic, visit consolidation |
| `packages/desktop/electron/services/date-parser-service.ts` | Smart date text recognition |
| `packages/desktop/electron/main/ipc-handlers/timeline-handlers.ts` | IPC channels |
| `packages/desktop/src/components/location/LocationTimeline.svelte` | Main timeline UI |
| `packages/desktop/src/components/location/TimelineEditModal.svelte` | Edit interface (accordion) |
| `packages/desktop/src/components/location/TimelineEvent.svelte` | Event row component |
| `packages/desktop/src/components/location/TimelineDateInput.svelte` | Smart date input field |
| `packages/desktop/src/components/location/LocationInfoHorizontal.svelte` | New horizontal info layout |

## Files to Modify

| File | Changes |
|------|---------|
| `packages/desktop/electron/main/database.ts` | Add Migration 68 (timeline table + backfill) |
| `packages/desktop/electron/main/database.types.ts` | Add timeline types |
| `packages/desktop/electron/preload/preload.cjs` | Add timeline IPC bridge |
| `packages/desktop/src/types/electron.d.ts` | Add timeline TypeScript types |
| `packages/desktop/src/pages/LocationDetail.svelte` | Layout restructure (Timeline left, Info below) |
| `packages/desktop/src/components/location/index.ts` | Export new components |
| `packages/desktop/electron/services/file-import-service.ts` | Generate visit events on import |
| `packages/desktop/electron/repositories/sqlite-location-repository.ts` | Create established + db_entry events on location create |
| `packages/desktop/electron/repositories/sqlite-media-repository.ts` | Update visit on media delete |

---

## Not in Scope (Future)

- Color coding for verification status (separate feature)
- Web source bookmark citations (waiting on bookmark system)
- Timeline export to CSV/JSON
- Timeline visualization (graphical timeline view)

---

## Approval Checklist

- [x] Layout changes approved
- [x] Data model approved
- [x] Component design approved
- [x] Implementation order approved
- [x] Questions answered
- [x] Gaps identified and fixed

---

*Plan v2 created following CLAUDE.md boot sequence. Implementation in progress.*
