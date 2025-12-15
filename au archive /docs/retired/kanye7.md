# KANYE7: LocationDetail Refactor + PUEA Implementation

**Version:** 7.0.0
**Created:** 2025-11-23
**Status:** IMPLEMENTATION GUIDE
**Type:** Refactoring Plan, LILBITS Compliance, Premium UX

---

## EXECUTIVE SUMMARY

### Problem Statement
LocationDetail.svelte is 1591 lines - violating LILBITS (300 line max) by 5x.

### Solution
Break into 11 focused components, each under 300 lines, orchestrated by a master component.

### New Rules Added to claude.md
- **PUEA:** Premium User Experience Always (show only what exists, graceful degradation)
- **AAA:** Archive App Always (every feature must support data interaction and research)

---

## ORIGINAL KANYE6 FIXES - VERIFICATION CHECKLIST

Before refactoring, verify these are preserved:

| Fix | Location | Status |
|-----|----------|--------|
| ensureGpsFromAddress() | Lines 181-223 | PRESERVE |
| setHeroImage() | Lines 386-399 | PRESERVE |
| Hero image display | Lines 644-697 | PRESERVE |
| GPS confidence 'geocoded_address' | Lines 343-345 | PRESERVE |
| Multi-tier thumbnails with srcset | Lines 1167-1178 | PRESERVE |
| Hero badge/Set Hero button | Lines 1188-1203 | PRESERVE |

---

## COMPONENT BREAKDOWN

### Directory Structure
```
packages/desktop/src/
├── pages/
│   └── LocationDetail.svelte      # Master orchestrator (~250 lines)
└── components/
    └── location/                   # NEW directory
        ├── LocationHero.svelte     # ~100 lines
        ├── LocationHeader.svelte   # ~80 lines
        ├── LocationInfo.svelte     # ~120 lines
        ├── LocationAddress.svelte  # ~100 lines
        ├── LocationMapSection.svelte # ~150 lines
        ├── LocationGallery.svelte  # ~200 lines
        ├── LocationVideos.svelte   # ~100 lines
        ├── LocationDocuments.svelte # ~80 lines
        ├── LocationImportZone.svelte # ~200 lines
        ├── LocationBookmarks.svelte # ~180 lines
        └── LocationNerdStats.svelte # ~150 lines
```

---

## IMPLEMENTATION GUIDE FOR LESS EXPERIENCED DEVELOPER

### Step 1: Create Directory
```bash
mkdir -p packages/desktop/src/components/location
```

### Step 2: Create Components (Order Matters)

#### 2.1 LocationHero.svelte (~100 lines)
**Purpose:** Display hero image with click-to-lightbox
**Props:**
- `images: MediaImage[]`
- `heroImgsha: string | null`
- `onOpenLightbox: (index: number) => void`

**PUEA Pattern:**
```svelte
{#if images.length > 0}
  <!-- Show hero image -->
{:else}
  <!-- Show placeholder with "Import images" prompt -->
{/if}
```

#### 2.2 LocationHeader.svelte (~80 lines)
**Purpose:** Location name, favorite star, edit button
**Props:**
- `location: Location`
- `onToggleFavorite: () => void`
- `onEditToggle: () => void`
- `isEditing: boolean`
- `togglingFavorite: boolean`

#### 2.3 LocationInfo.svelte (~120 lines)
**Purpose:** Type, condition, status, documentation, access
**Props:**
- `location: Location`
- `onNavigateFilter: (type: string, value: string) => void`

**PUEA Pattern:** Only render fields that have values
```svelte
{#if location.type}
  <div>Type: {location.type}</div>
{/if}
```

#### 2.4 LocationAddress.svelte (~100 lines)
**Purpose:** Address display with copy button, clickable city/state
**Props:**
- `address: Location['address']`
- `onNavigateFilter: (type: string, value: string) => void`

**PUEA Pattern:** Only show if address exists
```svelte
{#if address?.street || address?.city || address?.state}
  <!-- Render address -->
{/if}
```

#### 2.5 LocationMapSection.svelte (~150 lines)
**Purpose:** GPS coordinates, map embed, verify button
**Props:**
- `location: Location`
- `onMarkVerified: () => void`
- `verifying: boolean`

**Kanye6 Preserved:** GPS confidence badge including 'geocoded_address'

#### 2.6 LocationGallery.svelte (~200 lines)
**Purpose:** Image grid with hero selection, show more
**Props:**
- `images: MediaImage[]`
- `heroImgsha: string | null`
- `onOpenLightbox: (index: number) => void`
- `onSetHeroImage: (imgsha: string) => void`

**Kanye6 Preserved:**
- Multi-tier thumbnails with srcset
- "Set Hero" button on hover
- Hero badge display

#### 2.7 LocationVideos.svelte (~100 lines)
**Purpose:** Video list with duration, resolution, codec
**Props:**
- `videos: MediaVideo[]`
- `onOpenFile: (path: string) => void`

**PUEA Pattern:** Only render if videos.length > 0

#### 2.8 LocationDocuments.svelte (~80 lines)
**Purpose:** Document list
**Props:**
- `documents: MediaDocument[]`
- `onOpenFile: (path: string) => void`

**PUEA Pattern:** Only render if documents.length > 0

#### 2.9 LocationImportZone.svelte (~200 lines)
**Purpose:** Drag-drop zone, progress, GPS warnings, retry failed
**Props:**
- `isImporting: boolean`
- `importProgress: string`
- `isDragging: boolean`
- `gpsWarnings: GpsWarning[]`
- `failedFiles: FailedFile[]`
- `onDragOver: (e: DragEvent) => void`
- `onDragLeave: () => void`
- `onDrop: (e: DragEvent) => void`
- `onSelectFiles: () => void`
- `onRetryFailed: () => void`
- `onDismissWarning: (index: number) => void`

#### 2.10 LocationBookmarks.svelte (~180 lines)
**Purpose:** Bookmark list and add form
**Props:**
- `bookmarks: Bookmark[]`
- `locationId: string`
- `currentUser: string`
- `onBookmarkAdded: () => void`
- `onBookmarkDeleted: () => void`

#### 2.11 LocationNerdStats.svelte (~150 lines)
**Purpose:** Technical metadata (IDs, timestamps, GPS details, counts)
**Props:**
- `location: Location`
- `imageCount: number`
- `videoCount: number`
- `documentCount: number`

---

### Step 3: Refactor Master LocationDetail.svelte

The master component will:
1. Handle all state management
2. Load data on mount
3. Call ensureGpsFromAddress() - Kanye6
4. Pass data and callbacks to child components
5. Conditionally render only sections with data (PUEA)

**Structure:**
```svelte
<script>
  // All state variables
  // All handler functions (preserved from original)
  // onMount with loadLocation + ensureGpsFromAddress
</script>

{#if loading}
  <LoadingState />
{:else if error}
  <ErrorState />
{:else if location}
  <LocationHero ... />
  <LocationHeader ... />

  {#if !isEditing}
    <div class="grid grid-cols-2 gap-6">
      <LocationInfo ... />
      <div>
        {#if hasAddress}
          <LocationAddress ... />
        {/if}
        <LocationMapSection ... />
      </div>
    </div>

    <LocationImportZone ... />

    {#if images.length > 0}
      <LocationGallery ... />
    {/if}

    {#if videos.length > 0}
      <LocationVideos ... />
    {/if}

    {#if documents.length > 0}
      <LocationDocuments ... />
    {/if}

    <NotesSection ... />
    <LocationBookmarks ... />
    <LocationNerdStats ... />
  {:else}
    <LocationEditForm ... />
  {/if}

  <MediaViewer ... />
{/if}
```

---

### Step 4: Navigate After Import (AAA + PUEA)

**Current Behavior:** After import completes, stays on same page.
**Premium Behavior:** Already on LocationDetail - just reload to show new media.

The current implementation already does this:
```typescript
// In importFilePaths() after import completes:
loadLocation(); // Reloads to show new imports
```

This is correct AAA behavior - user interacts with their data immediately.

---

## AUDIT CHECKLIST

### Against claude.md

| Rule | Status | Notes |
|------|--------|-------|
| LILBITS (300 lines) | WILL PASS | All components under 300 lines |
| KISS | PASS | Each component does one thing |
| NME | PASS | No emojis |
| PUEA | PASS | Show only what exists |
| AAA | PASS | Import shows results immediately |
| DAFIDFAF | PASS | No new features, just refactor |

### Against Kanye6

| Feature | Status | Component |
|---------|--------|-----------|
| ensureGpsFromAddress | PRESERVED | Master (onMount) |
| setHeroImage | PRESERVED | LocationGallery callback |
| Hero display | PRESERVED | LocationHero |
| GPS 'geocoded_address' | PRESERVED | LocationMapSection |
| Multi-tier thumbnails | PRESERVED | LocationGallery |
| Set Hero button | PRESERVED | LocationGallery |

---

## TEST PLAN

### Test Images Location
```
/home/user/au-archive/website/abandonedupstate/public/assets/images/dw-winkleman/
```

Contains 14 JPG images suitable for import testing.

### Test Steps
1. Start app: `pnpm run dev`
2. Create test location "DW Winkleman Test"
3. Import images from test folder
4. Verify:
   - [ ] Import progress shows
   - [ ] Toast notification on completion
   - [ ] Page reloads showing new images
   - [ ] Thumbnails display correctly
   - [ ] "Set Hero" button appears on hover
   - [ ] Can set hero image
   - [ ] Hero displays at top

---

## IMPLEMENTATION ORDER

1. Create `components/location/` directory
2. Create shared types file (interfaces)
3. Create each component in order:
   - LocationHero
   - LocationHeader
   - LocationInfo
   - LocationAddress
   - LocationMapSection
   - LocationGallery
   - LocationVideos
   - LocationDocuments
   - LocationImportZone
   - LocationBookmarks
   - LocationNerdStats
4. Refactor LocationDetail.svelte to use components
5. Test all functionality
6. Verify line counts (all under 300)

---

## CHANGELOG

| Date | Action | Status |
|------|--------|--------|
| 2025-11-23 | Created refactor plan | DONE |
| 2025-11-23 | Added PUEA/AAA to claude.md | DONE |
| 2025-11-23 | Implementation guide written | DONE |
| 2025-11-23 | Component implementation | DONE |
| 2025-11-23 | Integration test created | DONE |
| 2025-11-23 | All 7 tests passing | DONE |

---

## TEST RESULTS

```
========================================
KANYE7 INTEGRATION TEST RESULTS
========================================
Location: DW Winkleman Co Inc
Location ID: d6742b0b-1399-4176-ac47-e5b8e1b4501a
Type: Industrial / Warehouse
Address: Syracuse, NY
Images Imported: 5
Hero Image Set: YES
========================================
LILBITS Compliance: PASS (all files < 300 lines)
Kanye6 Fixes: PRESERVED
PUEA: Premium UX tested
AAA: Data interaction verified
========================================

Test Files  1 passed (1)
     Tests  7 passed (7)
```

---

*This is kanye7.md - LocationDetail LILBITS refactor with PUEA/AAA implementation guide.*
