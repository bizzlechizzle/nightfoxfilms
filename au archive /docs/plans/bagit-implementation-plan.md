# BagIt Self-Documenting Archive Implementation Plan

**Status**: APPROVED - Ready for Implementation
**Created**: 2025-11-30
**Goal**: Make each location folder a standalone archive that survives 35+ years without the database

---

## Executive Summary

Each abandoned location will contain a complete, self-documenting archive package following the [BagIt RFC 8493](https://datatracker.ietf.org/doc/html/rfc8493) specification. This ensures:

1. **Database Independence** — Location can be understood without SQLite
2. **Integrity Verification** — SHA256 checksums for all files
3. **Industry Standard** — Library of Congress format, recognized by archivists
4. **35-Year Proof** — Plain text files readable by any future system

---

## User Requirements (From Prompts)

| Requirement | Decision |
|-------------|----------|
| Standard to use | Full BagIt (RFC 8493) |
| File location | `org-doc-[LOC12]/_archive/` subfolder |
| Existing locations | None (building new) |
| Contact info | Not required |
| Integrity checks | Weekly background schedule |
| Scope | Complete now, not deferred |

---

## Target Folder Structure

```
[archivePath]/locations/[STATE]-[TYPE]/[SLOCNAM]-[LOC12]/
├── org-img-[LOC12]/
│   ├── a3d5e8f9...jpg
│   └── a3d5e8f9...jpg.xmp          # Existing XMP sidecars
├── org-vid-[LOC12]/
│   └── b4e6f0ab...mp4
├── org-doc-[LOC12]/
│   ├── _archive/                    # NEW: BagIt package
│   │   ├── bagit.txt               # Version declaration
│   │   ├── bag-info.txt            # Location metadata
│   │   ├── manifest-sha256.txt     # Payload checksums
│   │   └── tagmanifest-sha256.txt  # Metadata checksums
│   └── [user documents...]          # User-added docs unchanged
└── org-map-[LOC12]/
```

---

## BagIt File Specifications

### 1. `bagit.txt` — Version Declaration (Static)

```
BagIt-Version: 1.0
Tag-File-Character-Encoding: UTF-8
```

**Generation**: Once on location creation, never changes.

---

### 2. `bag-info.txt` — Location Metadata (Human-Readable)

```
Source-Organization: Abandoned Archive
Bagging-Date: 2025-11-30
Bag-Software-Agent: Abandoned Archive v0.1.0
External-Identifier: abc123def456
External-Description: Seneca Army Depot - Main Bunker Complex
Location-Type: Military
Location-Access-Status: restricted
Location-State: NY
Location-City: Romulus
Location-County: Seneca
Location-Zipcode: 14541
Location-Street:
GPS-Latitude: 42.823400
GPS-Longitude: -76.845600
GPS-Source: map_confirmed
GPS-Verified-On-Map: true
GPS-Accuracy-Meters:
Region-Census: Northeast
Region-Division: Middle Atlantic
Region-State-Direction: Upstate NY
Region-Cultural: Finger Lakes
Payload-Oxum: 2400000000.53
Bag-Count: 1 of 1
Internal-Sender-Description: Former Cold War munitions storage facility...
```

**Key Fields:**
- `Payload-Oxum`: `bytes.filecount` for quick completeness check
- `External-Identifier`: The LOC12 ID
- All GPS/address fields for database reconstruction

**Generation**: On location create, update when metadata changes.

---

### 3. `manifest-sha256.txt` — Payload Checksums

```
a3d5e8f9abc123def456789012345678901234567890123456789012345678  ../org-img-abc123def456/a3d5e8f9abc123def456789012345678901234567890123456789012345678.jpg
b4e6f0abc234def567890123456789012345678901234567890123456789  ../org-img-abc123def456/b4e6f0abc234def567890123456789012345678901234567890123456789.jpg
c5f7g1bcd345efg678901234567890123456789012345678901234567890  ../org-vid-abc123def456/c5f7g1bcd345efg678901234567890123456789012345678901234567890.mp4
```

**Format**: `SHA256_HASH  RELATIVE_PATH` (two spaces between)

**Paths**: Relative to `_archive/` folder, so `../org-img-*/file.jpg`

**Generation**: On file import, update when files added/removed.

**Verification**: `cd _archive && shasum -a 256 -c manifest-sha256.txt`

---

### 4. `tagmanifest-sha256.txt` — Metadata Checksums

```
e8f9abc123def456789012345678901234567890123456789012345678901234  bagit.txt
f0abc234def567890123456789012345678901234567890123456789012345  bag-info.txt
g1bcd345efg678901234567890123456789012345678901234567890123456  manifest-sha256.txt
```

**Purpose**: Verify the metadata files themselves haven't been corrupted.

**Generation**: After any of the above files are written/updated.

---

## Generation Triggers

| Event | bagit.txt | bag-info.txt | manifest-sha256.txt | tagmanifest-sha256.txt |
|-------|-----------|--------------|---------------------|------------------------|
| Location created | Create | Create | Create (empty) | Create |
| Location metadata edited | — | Update | — | Update |
| Media file imported | — | Update (Payload-Oxum) | Add entry | Update |
| Media file deleted | — | Update (Payload-Oxum) | Remove entry | Update |
| Weekly integrity check | — | — | Validate only | Validate only |
| Manual regenerate | — | Regenerate | Regenerate | Regenerate |

---

## Background Integrity Checker

### Schedule
- **Frequency**: Weekly (configurable in future)
- **Trigger**: App launch if >7 days since last check
- **Scope**: All locations with `_archive/` folder

### Validation Process
1. For each location:
   a. Check `bagit.txt` exists and has correct version
   b. Parse `bag-info.txt`, extract `Payload-Oxum`
   c. Quick check: count files and sum sizes vs Payload-Oxum
   d. If quick check fails OR full validation due: verify all checksums
   e. Record result in database (`bag_last_verified`, `bag_status`)

### Status Values
| Status | Meaning | UI |
|--------|---------|-----|
| `valid` | All checksums pass | Green |
| `complete` | Files present, not verified | Blue |
| `incomplete` | Files missing | Yellow |
| `invalid` | Checksum mismatch | Red |
| `none` | No BagIt package yet | Gray |

### Database Fields (New)
```sql
ALTER TABLE locs ADD COLUMN bag_status TEXT DEFAULT 'none';
ALTER TABLE locs ADD COLUMN bag_last_verified TEXT;  -- ISO8601
ALTER TABLE locs ADD COLUMN bag_last_error TEXT;     -- Error message if any
```

---

## Service Architecture

### New Service: `bagit-service.ts`

```
packages/desktop/electron/services/bagit-service.ts
```

**Responsibilities:**
- Generate all 4 BagIt files
- Validate existing bags
- Update manifests on file changes
- Calculate Payload-Oxum

**Dependencies:**
- `crypto` (Node built-in) — SHA256 hashing
- `fs/promises` — File operations
- `path` — Path manipulation

**No external dependencies required.**

### New Service: `bagit-integrity-service.ts`

```
packages/desktop/electron/services/bagit-integrity-service.ts
```

**Responsibilities:**
- Schedule weekly validation
- Run validation in background (non-blocking)
- Update database with results
- Emit progress events for UI

---

## Integration Points

### 1. Location Creation (`sqlite-location-repository.ts`)

After location is saved:
```typescript
// After insert
await bagitService.initializeBag(location);
```

### 2. Location Update (`sqlite-location-repository.ts`)

After location metadata is updated:
```typescript
// After update
await bagitService.updateBagInfo(location);
```

### 3. Media Import (`file-import-service.ts`)

After files are copied to location:
```typescript
// After batch import completes
await bagitService.updateManifest(locationId, addedFiles);
```

### 4. Media Deletion (wherever this happens)

After file is removed:
```typescript
await bagitService.removeFromManifest(locationId, removedFileHash);
```

### 5. App Startup (`main/index.ts`)

Check if integrity validation is due:
```typescript
// After app ready
bagitIntegrityService.scheduleValidationIfDue();
```

---

## IPC Channels (New)

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `bagit:regenerate` | Renderer → Main | Force regenerate bag for location |
| `bagit:validate` | Renderer → Main | Validate single location |
| `bagit:validateAll` | Renderer → Main | Validate all locations |
| `bagit:status` | Renderer → Main | Get bag status for location |
| `bagit:progress` | Main → Renderer | Validation progress updates |

---

## UI Changes

### Location Detail Page
- Show bag status indicator (colored dot)
- Show "Last verified: [date]" text
- Add "Regenerate Archive" button
- Show error message if validation failed

### Settings Page
- Show "Last integrity check: [date]"
- Add "Verify All Locations" button
- Show progress bar during validation
- Display summary: "47 valid, 2 incomplete, 0 invalid"

---

## Error Handling

| Error | Recovery |
|-------|----------|
| Can't create `_archive/` folder | Log error, set status to 'none', continue |
| Can't write BagIt files | Retry once, then log and alert user |
| File missing during validation | Set status to 'incomplete', log which file |
| Checksum mismatch | Set status to 'invalid', log details |
| Disk full | Alert user, don't corrupt partial writes |

### Atomic Writes
All BagIt file writes should be atomic:
1. Write to temp file
2. Verify write succeeded
3. Rename to final location

---

## Implementation Tasks

### Phase 1: Core Service
1. [ ] Create `bagit-service.ts` with basic structure
2. [ ] Implement `generateBagitTxt()`
3. [ ] Implement `generateBagInfo(location)`
4. [ ] Implement `generateManifest(locationId)`
5. [ ] Implement `generateTagManifest()`
6. [ ] Implement `initializeBag(location)` — creates all files
7. [ ] Implement `updateBagInfo(location)` — updates metadata only
8. [ ] Implement `updateManifest(locationId, files)` — add/remove entries
9. [ ] Add unit tests for each method

### Phase 2: Database & Validation
10. [ ] Add migration for `bag_status`, `bag_last_verified`, `bag_last_error` columns
11. [ ] Create `bagit-integrity-service.ts`
12. [ ] Implement `validateBag(locationId)` — full validation
13. [ ] Implement `quickValidate(locationId)` — Payload-Oxum check only
14. [ ] Implement `validateAllBags()` — batch validation
15. [ ] Implement scheduling logic (check if >7 days)
16. [ ] Add unit tests

### Phase 3: Integration Hooks
17. [ ] Hook into location creation
18. [ ] Hook into location update
19. [ ] Hook into file import completion
20. [ ] Hook into file deletion
21. [ ] Hook into app startup for scheduled validation
22. [ ] Integration tests

### Phase 4: IPC & UI
23. [ ] Register IPC handlers for bagit channels
24. [ ] Expose in preload
25. [ ] Add bag status to Location type
26. [ ] Update Location Detail page with status/button
27. [ ] Update Settings page with validation UI
28. [ ] Add progress events for long validations

### Phase 5: Documentation
29. [ ] Write implementation guide
30. [ ] Update `docs/workflows/import.md`
31. [ ] Add `docs/contracts/bagit.md`
32. [ ] Update ARCHITECTURE.md

---

## Testing Strategy

### Unit Tests
- `bagit-service.test.ts`: File generation, parsing, checksums
- `bagit-integrity-service.test.ts`: Validation logic, scheduling

### Integration Tests
- Create location → verify `_archive/` created
- Import file → verify manifest updated
- Corrupt file → verify validation detects
- Delete file → verify manifest updated

### Manual Tests
- Create location, check files exist
- Run `shasum -a 256 -c manifest-sha256.txt` manually
- Edit location, verify bag-info.txt updates
- Wait 7 days (or mock), verify auto-validation runs

---

## Success Criteria

1. Every new location has `_archive/` with 4 BagIt files
2. Files update automatically on location/media changes
3. Weekly validation runs in background
4. `shasum -a 256 -c manifest-sha256.txt` works from command line
5. Location is fully reconstructable from `bag-info.txt` if database is lost
6. No external dependencies added
7. Works completely offline

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Performance impact on large imports | Medium | Low | Batch manifest updates, don't hash per-file |
| Disk space for checksums | Low | Low | ~100 bytes per file, negligible |
| User confusion about `_archive/` folder | Medium | Low | Clear naming, docs explain purpose |
| Breaking existing functionality | Low | High | Thorough integration testing |

---

## CLAUDE.md Compliance Checklist

| Rule | Status | Evidence |
|------|--------|----------|
| Scope Discipline | ✅ | Single feature: BagIt archival |
| Archive-First | ✅ | Core mission: preserve locations |
| Prefer Open Source | ✅ | BagIt is RFC standard |
| Offline-First | ✅ | No network, all local |
| One Script = One Function | ✅ | Separate services for generation vs validation |
| No AI in Docs | ✅ | No AI mentions in generated files |
| Keep It Simple | ✅ | Using standard format, minimal abstraction |
| Binary Dependencies | N/A | No binaries needed |
| Hashing Contract | ✅ | Uses existing SHA256 from files |
| Database Migrations | ✅ | New columns via proper migration |

---

## Appendix: Full bag-info.txt Field Reference

| Field | Source | Required |
|-------|--------|----------|
| Source-Organization | Hardcoded "Abandoned Archive" | Yes |
| Bagging-Date | Current date ISO8601 | Yes |
| Bag-Software-Agent | App version | Yes |
| External-Identifier | `loc12` | Yes |
| External-Description | `locnam` | Yes |
| Location-Type | `type` | Yes |
| Location-Access-Status | `access_status` | No |
| Location-State | `state` | No |
| Location-City | `city` | No |
| Location-County | `county` | No |
| Location-Zipcode | `zipcode` | No |
| Location-Street | `street` | No |
| GPS-Latitude | `gps_lat` | No |
| GPS-Longitude | `gps_lng` | No |
| GPS-Source | `gps_source` | No |
| GPS-Verified-On-Map | `gps_verified_on_map` | No |
| GPS-Accuracy-Meters | `gps_accuracy_meters` | No |
| Region-Census | `census_region` | No |
| Region-Division | `census_division` | No |
| Region-State-Direction | `state_direction` | No |
| Region-Cultural | `cultural_region` | No |
| Payload-Oxum | Calculated | Yes |
| Bag-Count | "1 of 1" | Yes |
| Internal-Sender-Description | `notes` | No |

---

**Plan Status**: COMPLETE - Ready for implementation
