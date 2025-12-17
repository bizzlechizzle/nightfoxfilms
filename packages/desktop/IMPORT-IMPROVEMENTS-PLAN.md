# Import System Improvements Plan

**Created:** 2025-12-16
**Status:** Planning
**Goal:** Fix import flow to properly create folder structure, extract metadata, generate proxies, and handle sidecars like AU Archive

---

## Issues Identified

| # | Issue | Root Cause | Impact |
|---|-------|------------|--------|
| 1 | No couple data in selected folder | `working_path` or `folder_name` not set on couple record | Documents folder never created |
| 2 | No footage type prompt | Auto-detection relies on dates; no fallback to ask user | Wrong footage type assigned |
| 3 | No thumbnails/gallery/proxies | No proxy generation service exists | Can't preview without opening full file |
| 4 | XML sidecars not parsed | XML imported as file but not parsed or linked | Camera XML metadata lost |
| 5 | Camera loans always shown | No conditional display based on deliverables | Cluttered UI |
| 6 | Medium shows "modern" not "Modern 4K" | Display mapping exists but not used everywhere | Inconsistent UI |
| 7 | recorded_at not extracted | ExifTool extraction may be failing silently | Footage type detection fails |

---

## Phase 1: Fix Core Import Flow (Critical)

### 1.1 Ensure working_path and folder_name are set

**Problem:** If couple doesn't have `working_path` configured, no files are copied to managed storage.

**Solution:**
1. When user clicks Import on CoupleDetail, check if `working_path` exists
2. If not, prompt user to select a working folder
3. Auto-generate `folder_name` from wedding_date + couple name if not set
4. Format: `YYYY-MM-DD-firstname-firstname` (e.g., `2025-12-31-julia-sven`)

**Files to modify:**
- `src/pages/CoupleDetail.svelte` - Add working_path check before import
- `electron/repositories/couples-repository.ts` - Add `generateFolderName()` helper

### 1.2 Fix recorded_at extraction

**Problem:** ExifTool may not be finding dates, causing footage_type to default to 'other'.

**Solution:**
1. Add debug logging to exiftool-service.ts
2. Check for additional date fields common in camera files
3. Fallback to file modification date if no EXIF date found
4. Add FFprobe format.tags.creation_time as backup

**Files to modify:**
- `electron/services/exiftool-service.ts` - Expand date field list, add fallback
- `electron/services/ffprobe-service.ts` - Extract creation_time from format.tags

### 1.3 Add footage type prompt when auto-detection fails

**Problem:** If dates don't match or recorded_at is null, user should be prompted.

**Solution:**
1. After scanning files, if any have unknown footage_type, show modal
2. Modal shows: file count, detected dates, couple's key dates
3. User selects: "Wedding Day", "Date Night", "Rehearsal", "Other"
4. Apply selection to all files or per-file

**Files to modify:**
- `src/pages/CoupleDetail.svelte` - Add footage type selection modal
- `electron/services/import-controller.ts` - Return unmatched files for user review

---

## Phase 2: Folder Structure & Documents

### 2.1 Create proper folder structure on import

**Target structure:**
```
{working_path}/{folder_name}/
  source/
    modern/{camera-slug}/{hash}.{ext}
    modern/{camera-slug}/{hash}.json  <- sidecar
    dadcam/...
    super8/...
  proxies/
    thumbs/{hash}.jpg                  <- 320px thumbnail
    preview/{hash}.mp4                 <- 720p proxy
  documents/
    manifest.json
    couple.json
    cameras.json
    import-log.json
    README.txt
```

**Solution:**
1. Create all directories upfront at import start
2. Copy service already handles source/{medium}/{camera}
3. Add proxy directory creation
4. Ensure documents sync runs after every import

**Files to modify:**
- `electron/services/import-controller.ts` - Create directory structure upfront
- `electron/services/import/copy-service.ts` - Verify path creation

### 2.2 Verify documents folder sync

**Problem:** `syncCoupleDocuments()` may not be called or may fail silently.

**Solution:**
1. Add explicit error handling and logging
2. Create documents folder even if import has errors (partial sync)
3. Add "Sync Documents" button to CoupleDetail for manual trigger

**Files to modify:**
- `electron/services/document-sync-service.ts` - Better error handling
- `src/pages/CoupleDetail.svelte` - Add manual sync button
- `electron/main/index.ts` - Add IPC handler for manual sync

---

## Phase 3: Thumbnail & Proxy Generation

### 3.1 Create thumbnail service

**Purpose:** Generate 320px JPEG thumbnails for gallery view.

**Implementation:**
```typescript
// electron/services/thumbnail-service.ts
export async function generateThumbnail(
  inputPath: string,
  outputPath: string,
  options?: { width?: number; seekPercent?: number }
): Promise<{ success: boolean; path: string | null; error: string | null }>
```

**Features:**
- Extract frame at 10% of video duration (skip black intros)
- Resize to 320px width, maintain aspect ratio
- Save as JPEG quality 85
- Store path in `files.thumbnail_path`

### 3.2 Create proxy service

**Purpose:** Generate 720p preview proxies for editing/review.

**Implementation:**
```typescript
// electron/services/proxy-service.ts
export async function generateProxy(
  inputPath: string,
  outputPath: string,
  options?: { height?: number; crf?: number }
): Promise<{ success: boolean; path: string | null; error: string | null }>
```

**Features:**
- Transcode to H.264, 720p height, CRF 23
- Fast decode preset for smooth playback
- Audio: AAC 128kbps stereo
- Store path in new `files.proxy_path` column

### 3.3 Integrate into import pipeline

**Flow:**
1. After VALIDATE step, before FINALIZE
2. Generate thumbnail for each video file
3. Optionally generate proxy (can be background job)
4. Store paths in database with file record

**Files to create:**
- `electron/services/thumbnail-service.ts`
- `electron/services/proxy-service.ts`

**Files to modify:**
- `electron/main/database.ts` - Add `proxy_path` column migration
- `electron/services/import-controller.ts` - Call thumbnail generation
- `packages/core/src/types.ts` - Add proxy_path to File interface

---

## Phase 4: XML Sidecar Parsing & Linking

### 4.1 Parse camera XML sidecars

**Problem:** Canon, Sony, RED cameras create XML sidecars with valuable metadata.

**Common XML formats:**
- Canon: `.THM` (thumbnail) + clip metadata
- Sony: `M4ROOT/CLIP/*.XML` with timecode, codec settings
- RED: `.RMD` files with camera settings
- ARRI: `.ARI` and `.MXF` sidecars

**Solution:**
1. During scan phase, identify XML files
2. Parse XML content to extract metadata
3. Match to parent video file by filename pattern
4. Store extracted data in `file_metadata` or dedicated table

**Implementation:**
```typescript
// electron/services/xml-sidecar-parser.ts
export interface ParsedSidecar {
  parentFilename: string;  // e.g., "A001_C001" for "A001_C001.XML"
  cameraModel: string | null;
  timecodeStart: string | null;
  frameRate: number | null;
  codec: string | null;
  colorSpace: string | null;
  whiteBalance: number | null;
  iso: number | null;
  shutterAngle: number | null;
  lens: string | null;
  rawData: Record<string, unknown>;
}

export function parseXmlSidecar(xmlPath: string): Promise<ParsedSidecar | null>
```

### 4.2 Link sidecars to video files

**Solution:**
1. After all files imported, run sidecar linking
2. Match by filename prefix (strip extension)
3. Use `file_sidecars` junction table
4. Merge sidecar metadata into parent file's metadata

**Files to create:**
- `electron/services/xml-sidecar-parser.ts`

**Files to modify:**
- `electron/services/import-controller.ts` - Add sidecar parsing step
- `electron/repositories/files-repository.ts` - Add sidecar linking methods

### 4.3 Hide redundant sidecar files from UI

**Problem:** XML sidecars clutter the file list.

**Solution:**
1. After linking, mark sidecar as `is_hidden = 1`
2. Gallery view filters out hidden files by default
3. Add toggle to show/hide sidecars in UI

---

## Phase 5: UI Improvements

### 5.1 Conditionally show camera loans section

**Problem:** Camera loans section shows even when not relevant.

**Condition to show:**
- Couple has deliverables that include date_night or engagement session
- OR couple already has camera loans

**Implementation:**
```svelte
{#if showCameraLoans}
  <section class="card loans-card">
    ...
  </section>
{/if}

<script>
  $: hasDateNightDeliverable = deliverables.some(d =>
    d.code.includes('datenight') || d.code.includes('engagement')
  );
  $: showCameraLoans = hasDateNightDeliverable || loans.length > 0;
</script>
```

**Files to modify:**
- `src/pages/CoupleDetail.svelte` - Add conditional display

### 5.2 Consistent medium display names

**Problem:** "modern" vs "Modern 4K" inconsistency.

**Solution:**
1. Create shared utility for medium display names
2. Use everywhere: CoupleDetail, Files list, Import, etc.

**Implementation:**
```typescript
// src/lib/format.ts
export const MEDIUM_LABELS: Record<string, string> = {
  modern: 'Modern 4K',
  dadcam: 'Dad Cam',
  super8: 'Super 8',
};

export function formatMedium(medium: string): string {
  return MEDIUM_LABELS[medium] || medium;
}
```

**Files to create:**
- `src/lib/format.ts` - Centralized formatting utilities

**Files to modify:**
- All files displaying medium values

### 5.3 Add file gallery view with thumbnails

**Problem:** No visual preview of imported files.

**Solution:**
1. Create gallery component showing thumbnails
2. Grid layout with lazy loading
3. Click to open detail/preview
4. Filter by footage_type, camera, medium

**Files to create:**
- `src/components/FileGallery.svelte`
- `src/components/FileThumbnail.svelte`

---

## Phase 6: Testing & Verification

### 6.1 Test import with real footage

**Test cases:**
1. Import single video file - verify sidecar, thumbnail, documents created
2. Import folder with subfolders - verify recursive scan works
3. Import folder with XML sidecars - verify parsing and linking
4. Import to couple without working_path - verify prompt appears
5. Import footage without EXIF dates - verify user prompt for footage type

### 6.2 Verify folder structure

**Check:**
- `source/{medium}/{camera}/{hash}.{ext}` exists
- `source/{medium}/{camera}/{hash}.json` sidecar exists
- `proxies/thumbs/{hash}.jpg` thumbnail exists
- `documents/` folder with all 5 files exists

### 6.3 Verify database records

**Check:**
- `files.managed_path` points to correct location
- `files.thumbnail_path` points to thumbnail
- `files.recorded_at` is populated
- `files.footage_type` is correct
- `file_metadata` has exiftool/ffprobe JSON
- `file_sidecars` links XML to video

---

## Implementation Order

| Order | Phase | Task | Priority | Effort |
|-------|-------|------|----------|--------|
| 1 | 1.1 | Fix working_path/folder_name flow | Critical | 2h |
| 2 | 1.2 | Fix recorded_at extraction | Critical | 1h |
| 3 | 2.2 | Verify documents sync | Critical | 1h |
| 4 | 3.1 | Create thumbnail service | High | 2h |
| 5 | 3.3 | Integrate thumbnails into import | High | 1h |
| 6 | 1.3 | Add footage type prompt | High | 2h |
| 7 | 4.1 | XML sidecar parsing | Medium | 3h |
| 8 | 4.2 | Sidecar linking | Medium | 1h |
| 9 | 5.1 | Conditional camera loans | Medium | 30m |
| 10 | 5.2 | Consistent medium labels | Low | 30m |
| 11 | 3.2 | Proxy generation | Low | 2h |
| 12 | 5.3 | File gallery view | Low | 3h |
| 13 | 6.x | Testing & verification | Required | 2h |

---

## Database Migrations Required

### Migration: Add proxy_path column
```sql
ALTER TABLE files ADD COLUMN proxy_path TEXT;
```

### Migration: Add sidecar_parsed flag
```sql
ALTER TABLE files ADD COLUMN sidecar_parsed INTEGER DEFAULT 0;
```

---

## Success Criteria

1. When I press Import on a couple page:
   - If no working_path, I'm prompted to select one
   - folder_name is auto-generated if missing
   - Files are copied to `source/{medium}/{camera}/{hash}.{ext}`
   - JSON sidecars are created next to each file
   - Thumbnails are generated in `proxies/thumbs/`
   - Documents folder is created with all 5 files
   - XML sidecars are parsed and linked to parent videos
   - Footage type is auto-detected or I'm prompted

2. On CoupleDetail page:
   - Camera loans only show if relevant to deliverables
   - Medium displays as "Modern 4K" not "modern"
   - Gallery shows thumbnails of all imported files

3. Files are self-documenting:
   - Each video has companion .json sidecar
   - Documents folder has complete manifest
   - Folder can be understood without database
