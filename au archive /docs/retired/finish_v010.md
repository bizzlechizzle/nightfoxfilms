# AU Archive v0.1.0 - Completion Plan

**Status**: IN PROGRESS
**Target**: 100% Feature Parity with Original Specification
**Current Score**: 82/100
**Goal Score**: 100/100

**IMPORTANT**: Nothing can be deferred to v0.2.0 without explicit approval.

---

## CRITICAL FEATURES (Blocking MVP - Must Complete)

### 1. Media Import Pipeline ⚠️ **CRITICAL**
**Status**: Not Implemented (UI exists, no backend)
**Priority**: P0 - Blocker
**Estimated Effort**: 5-8 hours

**Requirements:**
- ExifTool integration for image metadata extraction
- FFmpeg integration for video metadata extraction
- SHA256 file hashing for deduplication
- File organization to archive folder structure:
  - `[STATE]-[TYPE]/[SLOCNAM]-[LOC12]/org-img-[LOC12]/`
  - `[STATE]-[TYPE]/[SLOCNAM]-[LOC12]/org-vid-[LOC12]/`
  - `[STATE]-[TYPE]/[SLOCNAM]-[LOC12]/org-doc-[LOC12]/`
- File renaming: `[SHA256].[ext]`
- Database insertion (imgs, vids, docs tables)
- Duplicate detection by SHA256
- GPS extraction from EXIF data
- GPS mismatch detection and user prompts
- Delete original files if `delete_on_import` setting enabled
- Import queue/progress tracking

**Files to Create:**
- `packages/desktop/electron/services/exiftool-service.ts`
- `packages/desktop/electron/services/ffmpeg-service.ts`
- `packages/desktop/electron/services/file-import-service.ts`
- `packages/desktop/electron/services/crypto-service.ts`
- `packages/desktop/electron/repositories/sqlite-media-repository.ts`

**Files to Modify:**
- `packages/desktop/electron/main/ipc-handlers.ts` (add import handlers)
- `packages/desktop/src/pages/Imports.svelte` (connect to backend)

---

### 2. Media Display on Location Detail ⚠️ **CRITICAL**
**Status**: Placeholder Only
**Priority**: P0 - Blocker
**Estimated Effort**: 3-4 hours

**Requirements:**
- Hero image display (first image or logo placeholder)
- Images gallery grid view (thumbnails)
- Videos list with metadata (duration, resolution)
- Documents list with icons
- Maps list
- Click image → lightbox view
- Media metadata display (EXIF data, dimensions, date taken)
- Link to media files for viewing

**Files to Modify:**
- `packages/desktop/src/pages/LocationDetail.svelte`
- Create: `packages/desktop/src/components/MediaGallery.svelte`
- Create: `packages/desktop/src/components/ImageLightbox.svelte`

**IPC Handlers Needed:**
- `media:findByLocation` - Get all media for a location
- `media:openFile` - Open media file in system viewer

---

### 3. Database Backup Functionality ⚠️ **CRITICAL**
**Status**: Button exists, console.log stub
**Priority**: P0 - Data Safety
**Estimated Effort**: 1-2 hours

**Requirements:**
- Dialog to select backup destination
- Copy SQLite database file to selected location
- Timestamp backup filename: `au-archive-backup-YYYY-MM-DD-HHmmss.db`
- Show success/error notification
- Optional: Include media files in backup (zip archive)

**Files to Modify:**
- `packages/desktop/src/pages/Settings.svelte`
- `packages/desktop/electron/main/ipc-handlers.ts` (add backup handler)

---

### 4. Import History Tracking ⚠️ **CRITICAL**
**Status**: Not Implemented
**Priority**: P0 - Required for Dashboard
**Estimated Effort**: 2-3 hours

**Requirements:**
- Track each import session:
  - Import ID (UUID)
  - Timestamp
  - Location ID
  - File count (images, videos, docs)
  - User who imported
- Display recent imports on Dashboard (top 5)
- "Show all" imports page
- Link to location from import record

**Database Schema:**
```sql
CREATE TABLE imports (
  import_id TEXT PRIMARY KEY,
  locid TEXT REFERENCES locs(locid),
  import_date TEXT NOT NULL,
  auth_imp TEXT,
  img_count INTEGER DEFAULT 0,
  vid_count INTEGER DEFAULT 0,
  doc_count INTEGER DEFAULT 0,
  notes TEXT
);
```

**Files to Create:**
- Migration for imports table
- `packages/desktop/electron/repositories/sqlite-import-repository.ts`

**Files to Modify:**
- `packages/desktop/src/pages/Dashboard.svelte` (show recent imports)
- `packages/desktop/electron/main/database.ts` (add migration)
- `packages/desktop/electron/main/database.types.ts` (add ImportsTable)

---

### 5. Sub-Location Form UI ⚠️ **CRITICAL**
**Status**: Schema exists, no UI
**Priority**: P1 - Spec Requirement
**Estimated Effort**: 2-3 hours

**Requirements:**
- Checkbox: "This is a sub-location"
- If checked, show:
  - Parent location selector (dropdown with autofill)
  - Sub-location name (required)
  - Primary sub-location checkbox
- Create sub-location in database on submit
- Display sub-locations on location detail page
- List sub-locations on parent location

**Files to Modify:**
- `packages/desktop/src/components/LocationForm.svelte`
- `packages/desktop/src/pages/LocationDetail.svelte`
- `packages/desktop/electron/main/ipc-handlers.ts` (sub-location handlers)

---

## MAJOR FEATURES (Important for Complete v0.1.0)

### 6. Notes System 🔶 **MAJOR**
**Status**: Not Implemented
**Priority**: P1
**Estimated Effort**: 2-3 hours

**Requirements:**
- User notes on location detail page
- Rich text editor or markdown support
- Save notes to database
- Timestamp and author tracking
- Multiple notes per location (chronological list)

**Database Schema:**
```sql
CREATE TABLE notes (
  note_id TEXT PRIMARY KEY,
  locid TEXT REFERENCES locs(locid) ON DELETE CASCADE,
  note_text TEXT NOT NULL,
  note_date TEXT NOT NULL,
  auth_imp TEXT,
  note_type TEXT DEFAULT 'general'
);
```

**Files to Create:**
- Migration for notes table
- `packages/desktop/src/components/NotesSection.svelte`

---

### 7. True Projects System 🔶 **MAJOR**
**Status**: Shows regions (fake projects)
**Priority**: P1
**Estimated Effort**: 3-4 hours

**Requirements:**
- Create/Edit/Delete projects
- Project has:
  - Project name
  - Description
  - Date created
  - Location count
- Assign locations to projects (many-to-many)
- Dashboard shows:
  - Top 5 projects by location count
  - Recent projects
  - "Show all" projects page
- Project detail page:
  - List all locations in project
  - Map view of project locations

**Database Schema:**
```sql
CREATE TABLE projects (
  project_id TEXT PRIMARY KEY,
  project_name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_date TEXT NOT NULL,
  auth_imp TEXT
);

CREATE TABLE project_locations (
  project_id TEXT REFERENCES projects(project_id) ON DELETE CASCADE,
  locid TEXT REFERENCES locs(locid) ON DELETE CASCADE,
  added_date TEXT NOT NULL,
  PRIMARY KEY (project_id, locid)
);
```

**Files to Create:**
- Migrations for projects tables
- `packages/desktop/src/pages/Projects.svelte`
- `packages/desktop/src/pages/ProjectDetail.svelte`
- `packages/desktop/src/components/ProjectForm.svelte`

---

### 8. Autofill Typeahead in Forms 🔶 **MAJOR**
**Status**: Not Implemented
**Priority**: P1
**Estimated Effort**: 2-3 hours

**Requirements:**
- Location name field: Show suggestions as user types
- Type field: Show existing types
- Sub-type field: Show existing sub-types
- Author field: Show previous authors
- Address fields: Street address lookup (optional)
- Use debounced search (300ms)
- Dropdown with keyboard navigation

**Files to Create:**
- `packages/desktop/src/components/AutocompleteInput.svelte`

**Files to Modify:**
- `packages/desktop/src/components/LocationForm.svelte`
- Add IPC handlers for autocomplete queries

---

### 9. Hero Image Display 🔶 **MAJOR**
**Status**: Not Implemented
**Priority**: P1
**Estimated Effort**: 1 hour

**Requirements:**
- Display first image of location as hero
- If no images, show logo placeholder
- Click hero image → open in lightbox
- Set custom hero image (select from location's images)

**Files to Modify:**
- `packages/desktop/src/pages/LocationDetail.svelte`

---

### 10. Nerd Stats Section 🔶 **MAJOR**
**Status**: Not Implemented
**Priority**: P1
**Estimated Effort**: 1-2 hours

**Requirements:**
- Show metadata:
  - Location ID (locid)
  - Short ID (loc12)
  - Date added (locadd)
  - Last updated (locup)
  - GPS confidence level
  - GPS source
  - Media counts (images, videos, docs)
  - Database size contribution
- Collapsible section
- Copy ID buttons

**Files to Modify:**
- `packages/desktop/src/pages/LocationDetail.svelte`

---

## MINOR FEATURES (Polish & Completeness)

### 11. "Show All" Expansion Buttons 🟡 **MINOR**
**Status**: Not Implemented
**Priority**: P2
**Estimated Effort**: 1 hour

**Requirements:**
- Dashboard sections show top 5
- "Show all" button expands to full list
- Or navigates to dedicated page
- Recent locations → Locations page
- Top states → Locations filtered by state
- Top types → Locations filtered by type
- Projects → Projects page

**Files to Modify:**
- `packages/desktop/src/pages/Dashboard.svelte`

---

### 12. Embedded Web Browser 🟡 **MINOR** (Currently Deferred)
**Status**: Placeholder with external links
**Priority**: P2 (Can be v0.2.0 if approved)
**Estimated Effort**: 6-8 hours

**Requirements:**
- Replace placeholder with BrowserView API
- Embedded browser in window
- Right side toolbar:
  - Save bookmark button
  - Search bar (autofill locations)
  - Recents list (top 5 pages)
  - Projects list (top 5)
  - Bookmarks list
- Bookmark browser (hierarchical: state → type → location)
- Associate bookmarks with locations

**Notes:**
- Requires significant refactoring
- BrowserView API complex implementation
- **RECOMMENDATION**: Request approval to defer to v0.2.0

---

### 13. Web Bookmarks System 🟡 **MINOR**
**Status**: Not Implemented
**Priority**: P2
**Estimated Effort**: 2-3 hours

**Requirements:**
- Save web URLs with metadata:
  - URL
  - Title
  - Date saved
  - Associated location (optional)
  - Screenshot thumbnail (optional)
- Display bookmarks on location detail
- Bookmark browser page
- Open bookmarks in system browser (or embedded if implemented)

**Database Schema:**
```sql
CREATE TABLE bookmarks (
  bookmark_id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  title TEXT,
  locid TEXT REFERENCES locs(locid),
  bookmark_date TEXT NOT NULL,
  auth_imp TEXT,
  thumbnail_path TEXT
);
```

---

### 14. Login System 🟡 **MINOR**
**Status**: Not in current implementation
**Priority**: P3 (Clarify if needed)
**Estimated Effort**: 4-6 hours

**Requirements:**
- User accounts (if multi-user needed)
- Login screen
- Password hashing
- Session management
- User-specific data filtering

**Notes:**
- Original spec mentioned "login required" toggle
- Current implementation is single-user
- **RECOMMENDATION**: Clarify requirement with user before implementing

---

### 15. Map Import Features 🟡 **MINOR**
**Status**: Not Implemented
**Priority**: P3
**Estimated Effort**: 2-3 hours

**Requirements:**
- Import historical maps
- Associate maps with locations
- Display maps on location detail
- Georeferencing (optional)
- Map layers in Atlas view (optional)

**Notes:**
- Original spec: "Import map" button + "Map import" toggle
- Unclear specification
- **RECOMMENDATION**: Clarify requirements

---

## IMPLEMENTATION ORDER (Recommended)

### Phase 1: Critical Data Features (Week 1)
1. ✅ Database Backup (2 hours) - Data safety first
2. ✅ Import History Tracking (3 hours) - Foundation for dashboard
3. ✅ Media Import Pipeline (8 hours) - Core functionality
4. ✅ Media Display (4 hours) - Complete the loop

**Total**: ~17 hours

### Phase 2: UI Completeness (Week 1-2)
5. ✅ Sub-Location Form UI (3 hours)
6. ✅ Hero Image Display (1 hour)
7. ✅ Nerd Stats (2 hours)
8. ✅ Autofill Typeahead (3 hours)

**Total**: ~9 hours

### Phase 3: Major Features (Week 2)
9. ✅ Notes System (3 hours)
10. ✅ True Projects System (4 hours)
11. ✅ "Show All" Buttons (1 hour)

**Total**: ~8 hours

### Phase 4: Polish & Optional (Week 2-3)
12. ⚠️ Web Bookmarks System (3 hours) - If approved
13. ⚠️ Embedded Browser (8 hours) - Request approval to defer
14. ⚠️ Login System (6 hours) - Clarify requirement
15. ⚠️ Map Import (3 hours) - Clarify requirement

**Total**: ~20 hours (subject to approval)

---

## ESTIMATED TOTAL EFFORT

**Critical + Major**: ~34 hours
**Minor (approved items)**: ~20 hours
**Grand Total**: ~54 hours

**Timeline**: 1-2 weeks of focused development

---

## TESTING REQUIREMENTS

Each feature must have:
- ✅ Unit tests (repository layer)
- ✅ IPC handler tests
- ✅ Manual UI testing
- ✅ Integration tests for import pipeline
- ✅ Database migration tests

**Target Test Coverage**: 60%+

---

## APPROVAL NEEDED

**Items requiring user approval to defer:**
1. Embedded Web Browser (8 hours) → Defer to v0.2.0?
2. Login System (6 hours) → Is this needed for v0.1.0?
3. Map Import Features (3 hours) → Clarify specification?

**Total potential savings if approved**: ~17 hours

---

## DELIVERABLES

Upon completion, v0.1.0 will have:
- ✅ Complete media import pipeline with metadata extraction
- ✅ Full location management with sub-locations
- ✅ Rich location detail pages with media galleries
- ✅ Notes and projects systems
- ✅ Import history tracking
- ✅ Database backup
- ✅ Autofill in forms
- ✅ All dashboard widgets functional
- ✅ First-run setup wizard
- ✅ Production-ready build
- ✅ 60%+ test coverage

**Result**: 100% feature parity with original specification (excluding approved deferrals)

---

## NEXT STEPS

1. **User Review**: Get approval on deferrals (embedded browser, login, map import)
2. **Implementation**: Execute Phase 1-3 in order
3. **Testing**: Write tests as features are completed
4. **Documentation**: Update techguide.md and lilbits.md
5. **Final Audit**: Verify 100% compliance with finish_v010.md
6. **Release**: Ship v0.1.0! 🚀

---

**Document Version**: 1.0
**Last Updated**: 2025-11-21
**Author**: Claude (AU Archive Development)
