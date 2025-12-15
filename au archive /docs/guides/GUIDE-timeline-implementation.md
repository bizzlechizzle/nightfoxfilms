# Timeline Feature Implementation Guide

**Version**: 2.0
**Date**: December 2024
**Status**: COMPLETE

---

## Overview

This guide documents the complete implementation of the Timeline feature for the Abandoned Archive location detail pages.

### What Changed

| Before | After |
|--------|-------|
| Information box (55%) / Map (45%) | **Timeline box (55%)** / Map (45%) |
| Timeline below info/map row | **Horizontal Info strip** below timeline/map row |

### Visual Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│                        LOCATION DETAIL PAGE                         │
├────────────────────────────────┬────────────────────────────────────┤
│ TIMELINE (55%)                 │ MAP (45%)                          │
│ ┌────────────────────────────┐ │ ┌──────────────────────────────┐   │
│ │ Timeline            [edit] │ │ │ Location            [edit]  │   │
│ │ ● Built 1920s              │ │ │ [Interactive Map]           │   │
│ │ ○ March 15, 2024           │ │ │                             │   │
│ │   iPhone 14 Pro · 3 photos │ │ │ Address, GPS, etc.          │   │
│ │ ○ March 10, 2024           │ │ └──────────────────────────────┘   │
│ │   Canon EOS R5 · 5 photos  │ │                                    │
│ │ • Added Dec 10, 2024       │ │                                    │
│ └────────────────────────────┘ │                                    │
├────────────────────────────────┴────────────────────────────────────┤
│ HORIZONTAL INFO STRIP (full width)                                  │
│ ┌──────────────────────────────────────────────────────────────────┐│
│ │ STATUS     CATEGORY          BUILT    ABANDONED    FLAGS  [edit]││
│ │ Abandoned  Hospital/Psych    1920s    2005         Project      ││
│ └──────────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────────┤
│ SubLocationGrid, Notes, Import Zone, etc...                         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Files Modified/Created

### 1. Database Layer

**File**: `packages/desktop/electron/main/database.ts`
**Lines**: 2690-2786
**Migration**: 69

Creates `location_timeline` table with schema:

```sql
CREATE TABLE location_timeline (
  event_id TEXT PRIMARY KEY,
  locid TEXT NOT NULL REFERENCES locs(locid) ON DELETE CASCADE,
  subid TEXT REFERENCES slocs(subid) ON DELETE CASCADE,
  event_type TEXT NOT NULL,        -- established, visit, database_entry, custom
  event_subtype TEXT,              -- built, opened, expanded, renovated, etc.
  date_start TEXT,
  date_end TEXT,
  date_precision TEXT,             -- exact, month, year, decade, century, etc.
  date_display TEXT,               -- Human-readable display
  date_edtf TEXT,                  -- Extended Date/Time Format
  date_sort INTEGER,               -- YYYYMMDD for sorting
  date_override TEXT,              -- User correction
  override_reason TEXT,
  source_type TEXT,                -- exif, manual, web, document, system
  source_ref TEXT,
  source_device TEXT,              -- Camera make/model
  media_count INTEGER DEFAULT 0,
  media_hashes TEXT,               -- JSON array
  auto_approved INTEGER DEFAULT 0, -- 1 for cellphone devices
  user_approved INTEGER DEFAULT 0,
  approved_at TEXT,
  approved_by TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT,
  updated_at TEXT,
  updated_by TEXT
);
```

Backfill creates:
- `database_entry` event from `locadd` date
- `established` event (blank) for each location/sub-location

---

### 2. Database Types

**File**: `packages/desktop/electron/main/database.types.ts`
**Lines**: 42-43 (interface), 912-955 (table type)

Added `LocationTimelineTable` interface and database mapping.

---

### 3. Domain Types

**File**: `packages/core/src/domain/timeline.ts`
**Lines**: ~160

Defines Zod schemas and TypeScript types:
- `DatePrecisionSchema` - 13 precision values
- `EventTypeSchema` - established, visit, database_entry, custom
- `EstablishedSubtypeSchema` - built, opened, expanded, etc.
- `SourceTypeSchema` - exif, manual, web, document, system
- `TimelineEventSchema` - Full event validation
- `TimelineEventInput`, `TimelineEventUpdate` schemas
- `ParsedDate` interface
- Display label constants

---

### 4. Repository

**File**: `packages/desktop/electron/repositories/sqlite-timeline-repository.ts`
**Lines**: ~350

`SqliteTimelineRepository` class with methods:
- `findByLocation(locid)` - Get events for a location
- `findBySubLocation(locid, subid)` - Get events for a sub-location
- `findCombined(locid)` - Get all events including sub-locations
- `create(input, userId)` - Create new event
- `update(eventId, updates, userId)` - Update event
- `delete(eventId)` - Delete event
- `approve(eventId, userId)` - Approve/verify event
- `getVisitCount(locid)` - Count visit events
- `getEstablished(locid, subid)` - Get established date

---

### 5. Services

**File**: `packages/desktop/electron/services/date-parser-service.ts`
**Lines**: ~370

Smart date parsing with 15+ regex patterns:
- `parseDate(input)` - Parse human-friendly date strings
- `formatDateDisplay(parsed)` - Format for display
- `calculateDateSort(parsed)` - Calculate sort value
- `toEdtf(parsed)` - Convert to Extended Date/Time Format
- `getPrecisionDescription(precision)` - Describe precision type

**File**: `packages/desktop/electron/services/timeline-service.ts`
**Lines**: ~300

Business logic layer:
- `CELLPHONE_MAKES` - 17 manufacturer names for auto-approval
- `initializeLocation(locid, locadd, userId)` - Create initial events
- `initializeSubLocation(locid, subid, userId)` - Create sub-location events
- `handleMediaImport(...)` - Create/update visit events from EXIF
- `updateEstablished(...)` - Update established date with parsing

---

### 6. IPC Handlers

**File**: `packages/desktop/electron/main/ipc-handlers/timeline.ts`
**Lines**: ~130

13 IPC channels:
- `timeline:findByLocation`
- `timeline:findBySubLocation`
- `timeline:findCombined`
- `timeline:parseDate`
- `timeline:create`
- `timeline:update`
- `timeline:delete`
- `timeline:approve`
- `timeline:initializeLocation`
- `timeline:initializeSubLocation`
- `timeline:getVisitCount`
- `timeline:getEstablished`
- `timeline:updateEstablished`

---

### 7. Preload Bridge

**File**: `packages/desktop/electron/preload/preload.cjs`
**Lines**: 720-736

Exposes `timeline` object with all IPC methods.

---

### 8. TypeScript Types (Renderer)

**File**: `packages/desktop/src/types/electron.d.ts`
**Lines**: 944-959

Adds `timeline` interface to `ElectronAPI`.

---

### 9. UI Components

**File**: `packages/desktop/src/components/location/LocationTimeline.svelte`
**Lines**: ~260

Timeline display component:
- White card styling (`bg-white rounded border border-braun-300`)
- Header: "Timeline" + edit button
- Established event (filled dot) - always shown, blank if not set
- Visit events (hollow dot) - date, device, photo count
- Database entry (square dot) - "Added to Database · date"
- Edit mode: inline editing for established date
- Collapse/expand for 5+ visits

**File**: `packages/desktop/src/components/location/LocationInfoHorizontal.svelte`
**Lines**: ~400

Horizontal info strip:
- Displays: Status, Category/Class, Built, Abandoned, Flags
- Edit modal for quick changes
- Compact, scannable format

**File**: `packages/desktop/src/components/location/TimelineDateInput.svelte`
**Lines**: ~130 (existing)

Smart date input with:
- Debounced parsing
- 13 precision options
- 7 subtype options (built, opened, etc.)
- Real-time feedback

---

### 10. Layout Updates

**File**: `packages/desktop/src/pages/LocationDetail.svelte`
**Lines**: 1177-1222

Changed layout from:
```
Row: LocationInfo (55%) | LocationMapSection (45%)
     LocationTimeline (full width)
```

To:
```
Row: LocationTimeline (55%) | LocationMapSection (45%)
     LocationInfoHorizontal (full width)
```

---

### 11. Exports

**File**: `packages/desktop/src/components/location/index.ts`
**Lines**: 21-25

Added exports:
```typescript
export { default as LocationTimeline } from './LocationTimeline.svelte';
export { default as TimelineEventRow } from './TimelineEventRow.svelte';
export { default as TimelineDateInput } from './TimelineDateInput.svelte';
export { default as LocationInfoHorizontal } from './LocationInfoHorizontal.svelte';
```

---

## Testing

### Manual Testing Checklist

1. **Navigate to a location page**
   - [ ] Timeline should appear on left (55%)
   - [ ] Map should appear on right (45%)
   - [ ] Horizontal info strip below

2. **Timeline Display**
   - [ ] "Built —" shows for established date
   - [ ] Visit events show date, device, photo count
   - [ ] "Added to Database · [date]" at bottom

3. **Timeline Edit Mode**
   - [ ] Click "edit" toggles edit mode
   - [ ] Click established date opens inline editor
   - [ ] Date parsing shows real-time feedback
   - [ ] Save updates the display

4. **Horizontal Info Strip**
   - [ ] Shows Status, Category/Class, Built, Abandoned, Flags
   - [ ] Click "edit" opens modal
   - [ ] Changes save correctly

5. **Sub-location Pages**
   - [ ] Timeline shows sub-location events
   - [ ] Established date scoped to sub-location

---

## Braun Design Compliance

| Element | Specification | Implementation |
|---------|---------------|----------------|
| Container | `bg-white rounded border border-braun-300` | ✅ |
| Header | `text-2xl font-semibold`, `px-8 pt-6 pb-4` | ✅ |
| Body text | 15px | ✅ `text-[15px]` |
| Captions | 13px, `#5C5C58` | ✅ `text-[13px] text-braun-600` |
| Labels | 11px uppercase, `#8A8A86` | ✅ `.section-title` |
| Spacing | 8pt grid | ✅ `pb-4`, `gap-8` |
| Border-radius | 4px max | ✅ `rounded` |

---

## Architecture Alignment

Per CLAUDE.md requirements:

- ✅ **Scope Discipline** - Only timeline feature, no extras
- ✅ **Archive-First** - Serves research/metadata workflows
- ✅ **Offline-First** - No network calls
- ✅ **Keep It Simple** - Minimal abstraction
- ✅ **IPC Naming** - `timeline:action` format
- ✅ **Preload CommonJS** - Uses `require()`
