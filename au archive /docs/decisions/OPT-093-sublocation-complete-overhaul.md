# OPT-093: Sub-Location System Complete Overhaul

**Status:** Proposed (Awaiting Approval)
**Date:** 2025-12-07
**Author:** Claude (Comprehensive Audit)
**Severity:** CRITICAL - Data integrity and archival compliance at risk

---

## Executive Summary

The sub-location system has **7 critical bugs** beyond the import issue. The UI (LocationDetail.svelte) is well-implemented, but backend services treat sub-locations as second-class citizens. Media, GPS, stats, and archival metadata all flow to the host location instead of sub-locations.

**Bottom Line:** Sub-locations are a UI-only concept right now. The backend largely ignores them.

---

## Complete Bug Inventory

| # | Component | Severity | Issue |
|---|-----------|----------|-------|
| 1 | Import Finalizer | CRITICAL | `subid: null` hardcoded in all 8 insert locations |
| 2 | Auto-Hero Selection | CRITICAL | Only sets hero on host location, never sub-location |
| 3 | GPS Enrichment Job | CRITICAL | Queries by `locid` only, enriches host location |
| 4 | Location Stats Job | CRITICAL | Counts by `locid` only, never updates sub-location stats |
| 5 | Sub-Location Delete | CRITICAL | Media records orphaned (not deleted, not reassigned) |
| 6 | BagIt Archive | CRITICAL | No sub-location metadata in bag-info.txt |
| 7 | Copier Folder Logic | MODERATE | Inconsistent sub-location folder naming between v1/v2 |

---

## Detailed Analysis

### BUG 1: Import Finalizer (CRITICAL)

**Files:**
- `electron/services/import/finalizer.ts:74-80` - Interface missing `subid`
- `electron/services/import/copier.ts:86-92` - Interface missing `subid`
- `electron/main/ipc-handlers/import-v2.ts:165-172` - Handler drops `subid`

**Evidence:**
```typescript
// finalizer.ts - ALL batch insert methods hardcode subid: null
// Lines: 274, 316, 360, 389, 456, 532, 610, 673
const insertValues = files.map(file => ({
  // ...
  locid: location.locid,
  subid: null,  // ❌ HARDCODED - should be location.subid
  // ...
}));
```

**Impact:** ALL media imported via Import v2 to a sub-location gets assigned to host location.

---

### BUG 2: Auto-Hero Selection (CRITICAL)

**File:** `electron/services/import/finalizer.ts:855-886`

**Evidence:**
```typescript
private async autoSetHeroImage(locid: string, results: FinalizedFile[]): Promise<void> {
  // Check if LOCATION needs hero - never checks sub-location!
  const location = await this.db
    .selectFrom('locs')  // ❌ Only queries locs table
    .select(['locid', 'hero_imghash'])
    .where('locid', '=', locid)
    .executeTakeFirst();

  if (location && !location.hero_imghash) {
    // Sets hero on locs table only
    await this.db
      .updateTable('locs')  // ❌ Never touches slocs table
      .set({ hero_imghash: firstImage.hash })
      .where('locid', '=', locid)
      .execute();
  }
}
```

**Impact:** Sub-locations never get auto-hero images. Dashboard cards for sub-locations show no thumbnails.

---

### BUG 3: GPS Enrichment Job (CRITICAL)

**File:** `electron/services/job-worker-service.ts:627-744`

**Evidence:**
```typescript
private async handleGpsEnrichmentJob(payload: { locid: string }, ...): Promise<...> {
  // Only accepts locid - no subid parameter!
  const { locid } = payload;

  // Queries location table only
  const location = await this.db
    .selectFrom('locs')  // ❌ Never queries slocs
    .where('locid', '=', locid)
    ...

  // Searches media by locid only - misses subid filter!
  const imagesWithGps = await this.db
    .selectFrom('imgs')
    .where('locid', '=', locid)  // ❌ Should also filter by subid if targeting sub-location
    ...

  // Enriches locs table only
  const result = await enrichmentService.enrichFromGPS(locid, {...});  // ❌ Never enriches slocs
}
```

**Impact:** GPS from media imported to sub-locations enriches the HOST location, not the sub-location. Sub-locations stay GPS-less even when their media has coordinates.

---

### BUG 4: Location Stats Job (CRITICAL)

**File:** `electron/services/job-worker-service.ts:909-1000+`

**Evidence:**
```typescript
private async handleLocationStatsJob(payload: { locid: string }, ...): Promise<...> {
  // Only accepts locid - no subid!
  const { locid } = payload;

  // Counts ALL media for location, doesn't group by subid
  const imgResult = await this.db
    .selectFrom('imgs')
    .select([...])
    .where('locid', '=', locid)  // ❌ Counts all images, including sub-location media
    .where('hidden', '=', 0)
    ...

  // Updates locs table only
  await this.db
    .updateTable('locs')  // ❌ Never updates slocs
    .set({
      img_count: imgCount,
      vid_count: vidCount,
      ...
    })
    .where('locid', '=', locid)
    .execute();
}
```

**Impact:** Host location shows inflated media counts (includes sub-location media). Sub-locations have no cached stats.

---

### BUG 5: Sub-Location Delete (CRITICAL)

**File:** `electron/repositories/sqlite-sublocation-repository.ts:261-277`

**Evidence:**
```typescript
async delete(subid: string): Promise<void> {
  const existing = await this.findById(subid);
  if (!existing) return;

  // Only deletes the slocs record!
  await this.db
    .deleteFrom('slocs')
    .where('subid', '=', subid)
    .execute();

  // Updates parent's sublocs array
  await this.removeFromParentSublocs(existing.locid, subid);

  // ❌ MISSING: Delete media records with this subid
  // ❌ MISSING: Delete media files from disk
  // ❌ MISSING: Delete thumbnails/previews/posters
  // ❌ MISSING: Update BagIt manifest
}
```

**Compare to location delete** (`sqlite-location-repository.ts:578-706`):
- Deletes all media records
- Removes files from disk
- Cleans up thumbnails/previews/posters
- Full cascade

**Impact:** Deleting a sub-location leaves orphaned media records pointing to non-existent `subid`. Database integrity violation.

---

### BUG 6: BagIt Archive (CRITICAL)

**File:** `electron/services/bagit-service.ts:46-96`

**Evidence:**
```typescript
export interface BagLocation {
  locid: string;
  loc12: string;
  locnam: string;
  // ... many fields
  // ❌ NO subid field
  // ❌ NO sub-location name field
  // ❌ NO sub-location GPS fields
}

getArchiveFolderPath(location: BagLocation): string {
  // Only uses location.loc12 - no sub-location awareness
  const docFolder = `org-doc-${location.loc12}`;  // ❌ Same path for all sub-locations
  return path.join(..., docFolder, '_archive');
}
```

**Impact:**
- All sub-locations share the same BagIt manifest as host
- Sub-location names/GPS not captured in bag-info.txt
- **35 years from now:** Cannot reconstruct sub-location organization from archive alone

---

### BUG 7: Copier Folder Logic (MODERATE)

**Inconsistency between Import v1 and v2:**

**Import v1** (`phase-import-service.ts:648-651`):
```typescript
let mediaFolder = `org-${typePrefix}-${location.loc12}`;
if (subid) {
  mediaFolder = `org-${typePrefix}-${location.loc12}-${subid.substring(0, 12)}`;
}
// Creates: org-img-abc123-xyz789012345/
```

**Import v2** (`copier.ts` + `finalizer.ts`):
- No sub-location folder handling at all
- All media goes to `org-img-{loc12}/` regardless of subid

**Impact:** Media files physically stored in wrong location. Inconsistent folder structure.

---

## What I Would Do Differently

### Architecture Principles

1. **Treat sub-locations as first-class entities** - Not just a UI filter, but a full data model with its own stats, hero, GPS, and archive.

2. **Single source of truth for LocationInfo** - One interface definition, not duplicated across copier.ts and finalizer.ts.

3. **Job payloads include subid** - All per-location jobs should accept optional `subid` to target sub-locations.

4. **Separate BagIt per sub-location** - Each sub-location gets its own `_archive/` folder with independent manifest.

5. **Cascade delete properly** - Sub-location delete mirrors location delete behavior.

---

## Implementation Plan

### Phase 1: Core Import Fix (IMMEDIATE)

**Estimated Scope:** 4 files, ~50 line changes

#### 1.1 Create shared LocationInfo interface

**File:** `electron/services/import/types.ts` (NEW)

```typescript
/**
 * Location context for import operations
 * Single source of truth - used by copier, finalizer, orchestrator
 */
export interface LocationInfo {
  locid: string;
  loc12: string;
  address_state: string | null;
  type: string | null;
  slocnam: string | null;
  // Sub-location support
  subid: string | null;
  sub12?: string | null;  // Short ID for folder naming
}
```

#### 1.2 Update import-v2.ts handler

**File:** `electron/main/ipc-handlers/import-v2.ts`
**Lines:** 165-172

```typescript
// BEFORE
const result = await orchestrator.import(validated.paths, {
  location: {
    locid: validated.locid,
    loc12: validated.loc12,
    address_state: validated.address_state,
    type: validated.type,
    slocnam: validated.slocnam,
  },
  ...
});

// AFTER
const result = await orchestrator.import(validated.paths, {
  location: {
    locid: validated.locid,
    loc12: validated.loc12,
    address_state: validated.address_state,
    type: validated.type,
    slocnam: validated.slocnam,
    subid: validated.subid ?? null,
  },
  ...
});
```

#### 1.3 Update copier.ts

**File:** `electron/services/import/copier.ts`

```typescript
// Line 86-92: Update interface (or import from types.ts)
export interface LocationInfo {
  locid: string;
  loc12: string;
  address_state: string | null;
  type: string | null;
  slocnam: string | null;
  subid: string | null;  // ADD THIS
}

// Line ~200: Update folder path generation
private getMediaFolder(location: LocationInfo, mediaType: string): string {
  const typePrefix = this.getTypePrefix(mediaType);
  let folder = `org-${typePrefix}-${location.loc12}`;

  // Sub-location gets separate folder
  if (location.subid) {
    const sub12 = location.subid.substring(0, 12);
    folder = `org-${typePrefix}-${location.loc12}-${sub12}`;
  }

  return folder;
}
```

#### 1.4 Update finalizer.ts

**File:** `electron/services/import/finalizer.ts`

```typescript
// Line 74-80: Update interface (or import from types.ts)
export interface LocationInfo {
  locid: string;
  loc12: string;
  address_state: string | null;
  type: string | null;
  slocnam: string | null;
  subid: string | null;  // ADD THIS
}

// Lines 274, 316, 360, 389, 456, 532, 610, 673:
// Replace ALL instances of `subid: null` with:
subid: location.subid,
```

---

### Phase 2: Auto-Hero for Sub-Locations

**File:** `electron/services/import/finalizer.ts`

```typescript
// Modify autoSetHeroImage to accept subid
private async autoSetHeroImage(
  locid: string,
  subid: string | null,  // ADD parameter
  results: FinalizedFile[]
): Promise<void> {
  try {
    if (subid) {
      // Sub-location hero
      const subloc = await this.db
        .selectFrom('slocs')
        .select(['subid', 'hero_imghash'])
        .where('subid', '=', subid)
        .executeTakeFirst();

      if (subloc && !subloc.hero_imghash) {
        const firstImage = results.find(
          f => f.mediaType === 'image' && f.dbRecordId && !f.shouldHide
        );
        if (firstImage?.hash) {
          await this.db
            .updateTable('slocs')
            .set({ hero_imghash: firstImage.hash })
            .where('subid', '=', subid)
            .execute();
          console.log(`[Finalizer] Auto-set sub-location hero: ${firstImage.hash.slice(0, 12)}...`);
        }
      }
    } else {
      // Host location hero (existing logic)
      // ... existing code ...
    }
  } catch (error) {
    console.warn('[Finalizer] Auto-hero failed (non-fatal):', error);
  }
}

// Update call site (line ~222):
await this.autoSetHeroImage(location.locid, location.subid, results);
```

---

### Phase 3: GPS Enrichment for Sub-Locations

**File:** `electron/services/job-worker-service.ts`

#### 3.1 Update job payload type

```typescript
// Update payload to include optional subid
private async handleGpsEnrichmentJob(
  payload: { locid: string; subid?: string | null },
  emit: (event: string, data: unknown) => void
): Promise<{ enriched: boolean; source: string | null }> {
  const { locid, subid } = payload;
```

#### 3.2 Update media queries to filter by subid

```typescript
// When subid is provided, filter media by subid
const imagesWithGps = await this.db
  .selectFrom('imgs')
  .select(['imghash', 'meta_gps_lat', 'meta_gps_lng', 'meta_date_taken'])
  .where('locid', '=', locid)
  .$if(!!subid, qb => qb.where('subid', '=', subid!))  // Filter by subid if provided
  .where('meta_gps_lat', 'is not', null)
  .where('meta_gps_lng', 'is not', null)
  .orderBy('meta_date_taken', 'asc')
  .limit(1)
  .execute();
```

#### 3.3 Update target table

```typescript
if (subid) {
  // Enrich sub-location GPS
  await this.db
    .updateTable('slocs')
    .set({
      gps_lat: gpsSource.lat,
      gps_lng: gpsSource.lng,
      gps_source: 'media_gps',
    })
    .where('subid', '=', subid)
    .execute();

  emit('sublocation:gps-enriched', { subid, lat: gpsSource.lat, lng: gpsSource.lng });
} else {
  // Existing host location enrichment
  const result = await enrichmentService.enrichFromGPS(locid, {...});
  emit('location:gps-enriched', {...});
}
```

#### 3.4 Update finalizer to queue with subid

```typescript
// finalizer.ts buildJobList()
jobs.push({
  queue: IMPORT_QUEUES.GPS_ENRICHMENT,
  priority: JOB_PRIORITY.NORMAL,
  jobId: gpsEnrichmentJobId,
  payload: {
    locid,
    subid: location.subid,  // ADD: Pass subid to job
  },
  dependsOn: lastExifJobId ?? undefined,
});
```

---

### Phase 4: Location Stats for Sub-Locations

**File:** `electron/services/job-worker-service.ts`

```typescript
// Update payload
private async handleLocationStatsJob(
  payload: { locid: string; subid?: string | null },
  emit: (event: string, data: unknown) => void
): Promise<{...}> {
  const { locid, subid } = payload;

  // Build queries with optional subid filter
  const imgResult = await this.db
    .selectFrom('imgs')
    .select([...])
    .where('locid', '=', locid)
    .$if(!!subid, qb => qb.where('subid', '=', subid!))
    .where('hidden', '=', 0)
    .executeTakeFirst();

  // ... similar for vids, docs, maps ...

  // Update appropriate table
  if (subid) {
    await this.db
      .updateTable('slocs')
      .set({
        img_count: imgCount,
        vid_count: vidCount,
        doc_count: docCount,
        map_count: mapCount,
        // Note: slocs table needs these columns - Migration required
      })
      .where('subid', '=', subid)
      .execute();
  } else {
    await this.db
      .updateTable('locs')
      .set({...})
      .where('locid', '=', locid)
      .execute();
  }
}
```

**Migration required:** Add `img_count`, `vid_count`, `doc_count`, `map_count` columns to `slocs` table.

---

### Phase 5: Sub-Location Delete Cascade

**File:** `electron/repositories/sqlite-sublocation-repository.ts`

```typescript
async delete(subid: string): Promise<void> {
  const existing = await this.findById(subid);
  if (!existing) return;

  // Get archive path for cleanup
  const archiveSetting = await this.db
    .selectFrom('settings')
    .select('value')
    .where('key', '=', 'archive_folder')
    .executeTakeFirst();

  // 1. Get all media linked to this sub-location
  const images = await this.db.selectFrom('imgs').select(['imghash', 'imgloc']).where('subid', '=', subid).execute();
  const videos = await this.db.selectFrom('vids').select(['vidhash', 'vidloc']).where('subid', '=', subid).execute();
  const docs = await this.db.selectFrom('docs').select(['dochash', 'docloc']).where('subid', '=', subid).execute();

  // 2. Delete thumbnails, previews, posters
  if (archiveSetting?.value) {
    const mediaPathService = new MediaPathService(archiveSetting.value);
    for (const img of images) {
      await this.deleteMediaFiles(img.imghash, img.imgloc, mediaPathService);
    }
    for (const vid of videos) {
      await this.deleteMediaFiles(vid.vidhash, vid.vidloc, mediaPathService);
    }
  }

  // 3. Delete media records
  await this.db.deleteFrom('imgs').where('subid', '=', subid).execute();
  await this.db.deleteFrom('vids').where('subid', '=', subid).execute();
  await this.db.deleteFrom('docs').where('subid', '=', subid).execute();
  await this.db.deleteFrom('maps').where('subid', '=', subid).execute();

  // 4. Delete sub-location record
  await this.db.deleteFrom('slocs').where('subid', '=', subid).execute();

  // 5. Update parent
  await this.removeFromParentSublocs(existing.locid, subid);
  if (existing.is_primary) {
    await this.clearPrimaryOnParent(existing.locid);
  }

  // 6. Update BagIt manifest
  // TODO: Queue BagIt update job
}
```

---

### Phase 6: BagIt Sub-Location Support

**Option A: Shared manifest with sub-location metadata**

Add sub-location info to bag-info.txt:

```
Bag-Software-Agent: AU Archive v0.1.0
Bagging-Date: 2025-12-07
Location-Name: Jackson Sanatorium
Location-ID: abc123...
Sub-Locations: Main Building|xyz789, Power House|def456, Chapel|ghi012
Sub-Location-Main-Building-GPS: 42.123,-73.456
Sub-Location-Power-House-GPS: 42.124,-73.457
```

**Option B: Separate manifest per sub-location** (Recommended)

Create `_archive/` folder in each sub-location's media folder:
```
locations/NY-Hospital/JackSan-abc123/
  org-img-abc123-xyz789/
    _archive/
      bagit.txt
      bag-info.txt  (Main Building metadata)
      manifest-sha256.txt
  org-img-abc123-def456/
    _archive/
      bagit.txt
      bag-info.txt  (Power House metadata)
      manifest-sha256.txt
```

---

### Phase 7: Migration

**New migration in database.ts:**

```typescript
// Migration 53: Sub-location stats columns
const slocsColumns = sqlite.pragma('table_info(slocs)');
const slocsColumnNames = slocsColumns.map((col: { name: string }) => col.name);

if (!slocsColumnNames.includes('img_count')) {
  sqlite.exec(`
    ALTER TABLE slocs ADD COLUMN img_count INTEGER DEFAULT 0;
    ALTER TABLE slocs ADD COLUMN vid_count INTEGER DEFAULT 0;
    ALTER TABLE slocs ADD COLUMN doc_count INTEGER DEFAULT 0;
    ALTER TABLE slocs ADD COLUMN map_count INTEGER DEFAULT 0;
    ALTER TABLE slocs ADD COLUMN total_size_bytes INTEGER DEFAULT 0;
    ALTER TABLE slocs ADD COLUMN earliest_date TEXT;
    ALTER TABLE slocs ADD COLUMN latest_date TEXT;
  `);
}
```

---

## Does This Mirror Location Page Layouts?

**Yes and No.**

**UI (LocationDetail.svelte) - YES:**
- Lines 249-264: Media filtering works correctly
- Lines 370-403: Separate GPS handlers for sub-locations
- Lines 1033-1041: Hero image setting supports sub-locations
- The UI is well-designed to show sub-location-specific data

**Backend - NO:**
- Import ignores `subid`
- Jobs ignore `subid`
- Delete doesn't cascade
- Stats don't separate
- Archive doesn't capture

**The UI promises a feature the backend doesn't deliver.**

---

## Testing Checklist

After implementation:

- [ ] Import to sub-location: media `subid` is correct
- [ ] Import to sub-location: auto-hero sets on `slocs.hero_imghash`
- [ ] Import to sub-location: GPS enrichment updates `slocs.gps_*`
- [ ] Import to sub-location: stats update on `slocs` table
- [ ] Delete sub-location: media records deleted
- [ ] Delete sub-location: media files removed from disk
- [ ] Delete sub-location: thumbnails/previews cleaned up
- [ ] BagIt: sub-location metadata captured
- [ ] Resume: `subid` preserved across resume

---

## Approval Questions

1. **Scope:** Implement all 7 phases or prioritize?
2. **Migration:** Add stats columns to `slocs` table?
3. **BagIt:** Shared manifest (A) or separate per sub-location (B)?
4. **Data fix:** Manual reassignment or automated migration script?

**Awaiting human approval before proceeding.**
