# Dashboard Redesign Plan

## Summary

Simplify Dashboard layout: remove clutter, add stats row, show recent activity with 40×40 thumbnails.

## Target Layout

```
Dashboard

Stats: locations | images | videos | documents | bookmarks

Projects                                    {show all}
[Top 5 pinned/favorite locations]

Recent Locations          Recent Imports
[Last 5 clicked]          [Last 5 imported]
{show all}                {show all}

Top Type                  Top State
[Top 5 types by count]    [Top 5 states by count]
{show all}                {show all}
```

All list items get 40×40 square hero thumbnail.

## Changes Required

### 1. Dashboard.svelte (UI)

**Remove:**
- "New Location" button from header
- "Archive Stats" section at bottom
- Descriptions under section headers (KISS)

**Add:**
- Stats row below header (compact horizontal: 5 counts)

**Rename:**
- "Pinned Locations" → "Projects"

**Modify:**
- Recent Locations: "last 5 added" → "last 5 viewed" (by `last_viewed_at`)
- All sections: add 40×40 hero thumbnail per item

### 2. Backend APIs Needed

**New API: `location:findRecentlyViewed`**
- Returns locations ordered by `last_viewed_at DESC`
- Includes `hero_imgsha` for thumbnail lookup
- Files: repository, IPC handler, preload

**New API: `stats:topTypesWithHero`**
- Returns top types with a representative location's hero image

**New API: `stats:topStatesWithHero`**
- Returns top states with a representative location's hero image

**Existing APIs:**
- `locations.favorites()` - for Projects section (pinned locations)
- `imports.getTotalMediaCount()` - image/video/document counts
- `bookmarks.count()` - bookmark count
- `locations.count()` - location count
- `imports.findRecent(5)` - recent imports

### 3. Data Flow

```
onMount:
  1. locations.count() -> totalLocations
  2. imports.getTotalMediaCount() -> { images, videos, documents }
  3. bookmarks.count() -> totalBookmarks
  4. locations.favorites() -> projects (top 5 pinned)
  5. NEW: locations.findRecentlyViewed(5) -> recentLocations
  6. imports.findRecent(5) -> recentImports
  7. NEW: stats.topTypesWithHero(5) -> topTypes
  8. NEW: stats.topStatesWithHero(5) -> topStates
```

### 4. Thumbnails

- 40×40px square
- Source: location's `hero_imgsha` → lookup thumbnail path from imgs table
- Fallback: gray placeholder or initials

### 5. "show all" Navigation

| Section | Destination |
|---------|-------------|
| Projects | `/locations?filter=favorites` |
| Recent Locations | `/locations` |
| Recent Imports | `/imports` |
| Top Type | `/locations?type={type}` (clicked item) |
| Top State | `/locations?state={state}` (clicked item) |

## File Changes

| File | Change |
|------|--------|
| `Dashboard.svelte` | Major rewrite |
| `sqlite-location-repository.ts` | Add `findRecentlyViewed()` |
| `ipc-handlers/locations.ts` | Add handler |
| `ipc-handlers/stats-settings.ts` | Add hero variants |
| `preload/index.ts` | Expose new APIs |
| `types/electron.d.ts` | Type definitions |

## Decisions

- Projects = pinned/favorite locations (not separate entity)
- Thumbnails: 40×40
- Keep import progress banner during active imports
- KISS: No extra descriptions or wording
