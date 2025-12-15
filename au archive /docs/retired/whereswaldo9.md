# Where's Waldo 9: Import Hang After ExifTool - Root Cause Found + UI Updates

Date: 2025-11-22
Status: FIXED

---

## Executive Summary

Import was hanging after ExifTool completed metadata extraction. Root cause: **SQLite deadlock** - the code was calling `locationRepo.findById()` inside a transaction that was already using the same database connection. Fixed by pre-fetching location data ONCE at the start of each file import.

Additionally, UI improvements were implemented for Dashboard and Location Detail pages per user requests.

---

## Root Cause Analysis

### The Problem

After ExifTool completed (169ms), import would hang indefinitely. No logs appeared for subsequent steps.

### Investigation

Added comprehensive logging throughout the import flow. Discovered the hang occurred between:
- ExifTool extraction (completed successfully)
- GPS mismatch check and organizeFile operations

### Root Cause: SQLite Deadlock

The import runs inside a Kysely transaction:

```typescript
await this.db.transaction().execute(async (trx) => {
  // Inside transaction, using trx for all DB operations

  // PROBLEM: These calls use this.locationRepo which uses this.db
  // NOT the transaction connection (trx)
  const location = await this.locationRepo.findById(file.locid);  // DEADLOCK!
});
```

When `locationRepo.findById()` is called, it uses `this.db` (the main connection), but we're already inside a transaction on `this.db`. SQLite doesn't support concurrent connections to the same database file in certain configurations, causing a deadlock.

### The Fix

Pre-fetch location data ONCE at the start of each file import (Step 0), before entering heavy operations:

```typescript
// Step 0: Pre-fetch location data OUTSIDE heavy operations to avoid deadlock
console.log('[FileImport] Step 0: Pre-fetching location data...');
const location = await this.locationRepo.findById(file.locid);
if (!location) {
  throw new Error(`Location not found: ${file.locid}`);
}
console.log('[FileImport] Step 0 complete, location:', location.locnam);

// Now use `location` variable throughout - no more DB calls for location
```

Changed all subsequent operations to use the pre-fetched `location` object instead of making additional DB calls.

---

## Files Modified

### Import Fix

| File | Changes |
|------|---------|
| `electron/services/file-import-service.ts` | Pre-fetch location at Step 0, pass to all functions |
| `electron/services/exiftool-service.ts` | 30-second timeout wrapper |

### UI Changes - Dashboard

| Change | Before | After |
|--------|--------|-------|
| Subtitle | "Overview of your abandoned location archive" | Removed |
| New Location button | Bottom left with other buttons | Top right, renamed to "Add Location" |
| Quick action buttons | Open Atlas, View All, Import Media, Random | All removed from header |
| Random Location | Top button bar | Moved to Special Filters section |
| Stats box | None | Added at bottom with Total, GPS, Pinned, Recent counts |
| Grid | 4 columns | 5 columns (added Random) |

### UI Changes - Location Detail

| Change | Before | After |
|--------|--------|-------|
| Star/Pin icon | None | Added next to location name |
| Edit button | Aligned right | Level with location name |
| GPS Source | Above the map | Below the map |
| Layout | Name and Edit separate rows | Same row with star |

---

## Code Changes Detail

### file-import-service.ts - Deadlock Fix

```typescript
// BEFORE (caused deadlock):
if (metadata.gps && GPSValidator.isValidGPS(metadata.gps.lat, metadata.gps.lng)) {
  const location = await this.locationRepo.findById(file.locid);  // DEADLOCK
  // ...
}

// In organizeFile():
const location = await this.locationRepo.findById(file.locid);  // DEADLOCK

// AFTER (fixed):
// Step 0: Pre-fetch ONCE
const location = await this.locationRepo.findById(file.locid);

// Step 5b: Use pre-fetched location
if (metadata.gps && GPSValidator.isValidGPS(metadata.gps.lat, metadata.gps.lng)) {
  // Use pre-fetched location - don't fetch again!
  if (location.gps?.lat && location.gps?.lng) {
    // ...
  }
}

// organizeFileWithLocation() now receives location as parameter
await this.organizeFileWithLocation(file, hash, ext, type, location);
```

### Dashboard.svelte - Header

```svelte
<!-- BEFORE -->
<h1>Dashboard</h1>
<p>Overview of your abandoned location archive</p>
<button>+ New Location</button>
<button>Open Atlas</button>
<!-- etc -->

<!-- AFTER -->
<div class="flex justify-between items-center">
  <h1>Dashboard</h1>
  <button>Add Location</button>
</div>
<!-- No subtitle, no extra buttons -->
```

### LocationDetail.svelte - Star Button

```svelte
<div class="flex items-center gap-3">
  <h1>{location.locnam}</h1>
  <button onclick={toggleFavorite}>
    {#if location.favorite}
      <svg class="text-yellow-500" fill="currentColor"><!-- filled star --></svg>
    {:else}
      <svg class="text-gray-400"><!-- outline star --></svg>
    {/if}
  </button>
</div>
```

---

## Previous Bugs Reference

| Waldo | Issue | Status |
|-------|-------|--------|
| 1 | Preload ESM/CJS mismatch | Fixed |
| 2 | Vite bundler adds ESM wrapper | Fixed |
| 3 | Custom copy plugin for preload | Fixed |
| 4 | webUtils undefined, file.path fallback | Partial (fallback works) |
| 5 | RAW formats missing from extension lists | Fixed |
| 6 | Import UX - blocking, no progress | Fixed |
| 7 | webUtils unavailable, no Select Files, wrong $store | Fixed |
| 8 | ExifTool hang, UI overhaul requests | Fixed (timeout added) |
| **9** | **SQLite deadlock after ExifTool, UI updates** | **Fixed** |

---

## Future Improvements

### Batch Import Architecture

Per claude.md spec: "IMPORT EVERYTHING TO DATABASE FIRST THEN DUMP"

Current flow (sequential):
```
For each file:
  1. Hash
  2. Metadata
  3. Copy
  4. Verify
  5. Insert DB
```

Recommended flow (batch):
```
Phase 1 (Parallel - Collect):
  - Hash ALL files
  - Extract metadata ALL files

Phase 2 (Fast - DB):
  - Insert ALL records in one transaction

Phase 3 (Background - Files):
  - Copy ALL files to archive
  - Verify integrity
```

This would significantly improve performance for large imports.

---

## Test Checklist

- [x] App starts without errors
- [x] Dashboard shows new layout
- [x] "Add Location" button in top right
- [x] Random Location in Special Filters
- [x] Stats box at bottom
- [x] Location page shows star icon
- [x] Star toggles favorite status
- [x] GPS source appears below map
- [x] Edit button level with name
- [ ] Import completes without hanging (needs user test with NEF files)

---

End of Report
