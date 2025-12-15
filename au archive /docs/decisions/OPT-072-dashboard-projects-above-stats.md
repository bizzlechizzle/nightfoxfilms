# OPT-072: Dashboard Projects Bar Above Stats

**Date:** 2025-12-06
**Status:** Implemented
**Component:** Dashboard.svelte

---

## Change

Moved the Projects (Pinned Locations) section from the main content area to directly below the page title, above the Stats Row.

## Previous Layout

```
Title
Stats Row
---
[Import Status - conditional]
[Recent Background Imports - conditional]
Projects
Recent Locations | Recent Imports
Top Type | Top State
```

## New Layout

```
Title
Projects (always visible)
Stats Row
---
[Import Status - conditional]
[Recent Background Imports - conditional]
Recent Locations | Recent Imports
Top Type | Top State
```

## Rationale

Projects represent the user's active work areas and should have top-level visibility immediately after the page title. Stats are reference information that can follow.

## Implementation

- `packages/desktop/src/pages/Dashboard.svelte`
  - Moved Projects section into header area (lines 166-202)
  - Projects bar always renders when not loading
  - Shows "No pinned locations yet" when empty
  - Removed duplicate Projects section from main content area

## Files Changed

- `packages/desktop/src/pages/Dashboard.svelte`
