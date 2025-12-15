# Missing Features for v0.1.0

**Status:** Work in Progress
**Target:** 100% feature completion for v0.1.0 release

---

## CRITICAL MISSING FEATURES (Must Have)

### 1. Search Page (0%)
**Status:** Missing entirely
**Spec:** pages/page_search.md (not found - inferred from desktop_app.md)
**Location:** packages/desktop/src/pages/Search.svelte
**Requirements:**
- Advanced search across all location fields
- Filter by: name, type, state, GPS status, documentation status
- Search results table with clickable rows
- Save search queries
- Should be separate from Locations page basic filter

**Priority:** HIGH

---

### 2. Dashboard - Action Buttons (0%)
**Status:** Missing
**Spec:** pages/page_dashboard.md:19-23
**Location:** packages/desktop/src/pages/Dashboard.svelte
**Requirements:**
- Favorites button - show favorited locations
- Random button - show random location
- Un-documented button - show locations with "No Visit / Keyboard Scout"
- Historical button - show historic=1 locations

**Priority:** HIGH

---

### 3. Dashboard - Projects Section (0%)
**Status:** Missing concept entirely
**Spec:** pages/page_dashboard.md:1-7
**Location:** Need to define "Project" concept
**Requirements:**
- Define what a "Project" is (collection of locations?)
- Show top 5 recent projects
- Show all projects link
- Need new database table or relationship?

**Priority:** MEDIUM (unclear spec)

---

### 4. Dashboard - Recent Imports (0%)
**Status:** Missing
**Spec:** pages/page_dashboard.md:5-7
**Location:** packages/desktop/src/pages/Dashboard.svelte
**Requirements:**
- Show top 5 recent imports
- Show all imports link
- Link to import records (imgs/vids/docs tables)

**Priority:** MEDIUM (depends on import backend)

---

### 5. Edit Location Functionality (0%)
**Status:** Missing
**Spec:** pages/page_location.md:1-3
**Location:** packages/desktop/src/pages/LocationDetail.svelte
**Requirements:**
- Edit button (top right)
- Update button (top right)
- Form to edit all location fields
- IPC handler for update
- Validation with Zod

**Priority:** CRITICAL

---

### 6. Settings Persistence (0%)
**Status:** UI only, no backend
**Spec:** pages/page_settings.md:15-16
**Location:** packages/desktop/src/pages/Settings.svelte
**Requirements:**
- Save settings to database (settings table exists)
- Load settings on mount
- IPC handlers for settings CRUD
- Store: archive_folder, delete_on_import, current_user, tile_cache

**Priority:** HIGH

---

### 7. Media Lists on Location Detail (0%)
**Status:** Missing
**Spec:** pages/page_location.md:13-20
**Location:** packages/desktop/src/pages/LocationDetail.svelte
**Requirements:**
- Images list (from imgs table)
- Videos list (from vids table)
- Documents list (from docs table)
- Bookmarks list (need to define)
- User notes (need to define)
- Note box (need to define)

**Priority:** MEDIUM (depends on import backend)

---

### 8. Supercluster for Map (0%)
**Status:** Not implemented
**Spec:** pages/page_atlas.md:26
**Location:** packages/desktop/src/components/Map.svelte
**Requirements:**
- Install supercluster package
- Cluster markers when zoomed out
- Show cluster count
- Expand on click

**Priority:** MEDIUM (performance feature)

---

### 9. CartoLabels Overlay (0%)
**Status:** Missing
**Spec:** pages/page_atlas.md:24
**Location:** packages/desktop/src/components/Map.svelte
**Requirements:**
- Add CartoDB labels overlay layer
- Layer switcher to toggle

**Priority:** LOW (nice-to-have)

---

## COMPLETED FEATURES

All features marked as "deferred" have been implemented:

### Web Browser Page - COMPLETED
**Status:** Fully implemented
**Location:** packages/desktop/src/pages/WebBrowser.svelte
**Features:**
- Embedded webview with navigation controls
- Bookmark system with save/load
- Recent pages tracking
- Quick actions for common research sites
- Search integration

### Supercluster for Map - COMPLETED
**Status:** Fully implemented
**Location:** packages/desktop/src/components/Map.svelte
**Features:**
- Marker clustering when zoomed out
- Click to expand clusters
- Individual markers when zoomed in
- Cluster count display

### CartoLabels Overlay - COMPLETED
**Status:** Fully implemented
**Location:** packages/desktop/src/components/Map.svelte
**Features:**
- CartoDB labels overlay layer
- Layer switcher to toggle on/off

### Projects System - COMPLETED
**Status:** Implemented using regions
**Location:** packages/desktop/src/pages/Dashboard.svelte
**Features:**
- Projects section on Dashboard
- Grouped by location regions
- Top 5 projects display

### Recent Imports - COMPLETED
**Status:** UI implemented
**Location:** packages/desktop/src/pages/Dashboard.svelte
**Features:**
- Recent Imports section on Dashboard
- Ready for media import backend integration

---

## IMPLEMENTATION ORDER

1. **Settings Persistence** (foundation for everything else)
2. **Edit Location** (critical workflow)
3. **Dashboard Action Buttons** (quick win)
4. **Search Page** (enhances usability)
5. **Supercluster** (performance)
6. **Media Lists on Detail Page** (requires mock data or import)
7. **Projects System** (needs design discussion)
8. **Recent Imports** (depends on import backend)

---

## COMPLIANCE CHECK

All implementations must follow:
- LILBITS: Max 300 lines per file
- NME: No emojis ever
- TypeScript strict mode
- Svelte 5 runes
- Clean Architecture pattern
- IPC security via contextBridge

---

**Last Updated:** 2025-11-21
**Progress:** 0/8 critical features implemented
