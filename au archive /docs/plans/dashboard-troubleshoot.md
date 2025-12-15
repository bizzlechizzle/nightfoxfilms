# Dashboard Troubleshooting Plan

## Issues Identified

### 1. Projects Not Showing (Willard is flagged but not appearing)

**Root Cause:** Semantic mismatch between UI and data query.

- **DB state:** Willard has `project = 1` and `favorite = 0`
- **Dashboard query:** Uses `locations.favorites()` which filters by `favorite = 1`
- **Expected:** "Projects" section should show locations where `project = 1`

**Fix:** Change Dashboard to query `locations.findAll({ project: true })` instead of `locations.favorites()`

### 2. Dashboard Goes Blank

**Root Cause:** Error in `onMount` causes loading state to fail silently.

The `Promise.all()` approach means if ANY API call fails, the entire dashboard fails. Currently the catch block only logs to console, leaving user with blank page.

**Fix:** Add better error handling and fallback UI. Consider individual try/catch for each section.

### 3. Thumbnail Loading Issues

**Root Cause:** Electron security - renderer cannot load `file://` URLs directly.

Already addressed by removing thumbnails from Top Type/Top State. Projects and Recent Locations still have gray placeholder divs (no actual images attempted).

**Status:** Deferred - thumbnails removed from current layout.

## Database Verification

```
Willard Asylum for the Chronic Insane:
- project = 1 (flagged as project)
- favorite = 0 (NOT favorited)
- last_viewed_at = 2025-11-29T12:54:00.530Z (recently viewed)
- view_count = 1

Total locations: 2
Locations with project=1: 1 (Willard)
Locations with favorite=1: 0
```

## Changes Required

### Dashboard.svelte

1. **Line 83:** Change `window.electronAPI.locations.favorites()` to `window.electronAPI.locations.findAll({ project: true })`

2. **Error handling:** Wrap each data fetch in individual try/catch to prevent one failure from blanking the entire dashboard

### Optional: Add IPC shortcut

Could add `locations.projects()` convenience method, but `findAll({ project: true })` already works.

## File Changes

| File | Change |
|------|--------|
| `Dashboard.svelte:83` | Change `favorites()` to `findAll({ project: true })` |
| `Dashboard.svelte:63-106` | Improve error handling |

## Testing Checklist

- [ ] Willard appears in Projects section
- [ ] Dashboard doesn't go blank on partial API failure
- [ ] Recent Locations shows recently viewed items
- [ ] Stats row shows correct counts
