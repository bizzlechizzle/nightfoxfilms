# Settings Area Cleanup Plan

## Objective
Consolidate scattered Settings sections into a clean "Archive" accordion with sub-accordions for Maps and Maintenance. Remove all description text, stay on-brand with accent color styling. Repair buttons trigger a location picker popup.

---

## Current State Analysis

### Sections to Consolidate (4 separate boxes → 1 accordion)
1. **Archive Folder** - Path input + Browse button + description
2. **Import Options** - 3 checkboxes with descriptions
3. **Media Maintenance** - Fix Images, Fix Videos, Normalize Addresses, Backfill Regions, Live Photo Detection, Video Proxy Cache
4. **Reference Maps** - Map list, import button, purge catalogued
5. **Database** (component) - Backup Database, Restore Database

### Sections to Preserve (not touched)
- **Users** section (already cleaned up)
- **HealthMonitoring** component
- **Save Settings** button at bottom

---

## Target Layout

```
Archive                                                        {▼}

Archive Location                              /path/to/archive  [edit]
Delete on Import                                              [toggle]

    Maps                                                       {▼}
    map-file-1.kml                    2024-01-15        1,234 points
    map-file-2.gpx                    2024-02-20          567 points
                                                       [import map]

    Maintenance                                                {▼}

    [Backup Database]

    Repair
    [Purge Cache] [Restore Database] [Fix Addresses] [Fix Images] [Fix Videos]
```

When user clicks a repair button (Purge Cache, Fix Addresses, Fix Images, Fix Videos), a **POPUP MODAL** appears:

```
┌─────────────────────────────────────────────────────────────────┐
│  Fix Images                                              [X]    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Search location...                                             │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                                                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ▼ Matching locations (dropdown when typing)                    │
│    Willard Asylum - NY                                          │
│    Williams Lake Resort - CA                                    │
│                                                                 │
│                           [Fix All]  or  [Fix] (when selected)  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Changes Required

### 1. State Variables
```typescript
// Archive accordion
let archiveExpanded = $state(true);
let mapsExpanded = $state(false);
let maintenanceExpanded = $state(false);

// Location picker modal
let showLocationPicker = $state(false);
let pickerMode = $state<'purge' | 'addresses' | 'images' | 'videos' | null>(null);
let pickerSearchQuery = $state('');
let pickerSearchResults = $state<Location[]>([]);
let pickerSelectedLocation = $state<Location | null>(null);
```

### 2. Archive Accordion (main)
- Same pattern as Users accordion (chevron right side, accent color)
- Dynamic padding: expanded = p-6, collapsed = px-6 py-4
- Contains: Archive Location, Delete on Import, Maps sub-accordion, Maintenance sub-accordion

### 3. Archive Location Row
- Label: "Archive Location"
- Display current path (truncated if long)
- "edit" text link on right → opens folder picker
- No description text

### 4. Delete on Import Row
- Label: "Delete on Import"
- Checkbox toggle on right (same style as Users "Require PIN")
- No description text

### 5. Maps Sub-Accordion
Header: "Maps" with chevron
Content when expanded:
- Table of imported maps: name | date imported | total points
- Delete icon (trash) per row
- "import map" text link at bottom right
- No stats box, no descriptions

### 6. Maintenance Sub-Accordion
Header: "Maintenance" with chevron
Content when expanded:
- **[Backup Database]** button (standalone, accent color)
- **Repair** label (small heading)
- Row of buttons (all accent color):
  - [Purge Cache] → opens location picker modal
  - [Restore Database] → existing restore flow (file picker)
  - [Fix Addresses] → opens location picker modal
  - [Fix Images] → opens location picker modal
  - [Fix Videos] → opens location picker modal

### 7. Location Picker Modal
Shared modal component triggered by repair buttons:

**State flow:**
1. User clicks repair button (e.g., "Fix Images")
2. Modal opens with `pickerMode = 'images'`
3. Search bar with typeahead dropdown
4. User can:
   - Leave empty → button shows "Fix All Images"
   - Select location → button shows "Fix Images"
5. Click action button → runs operation → closes modal

**Modal contents:**
- Title based on mode ("Fix Images", "Fix Addresses", etc.)
- Close X button
- Search input with placeholder "Search location..."
- Typeahead dropdown (up to 10 results)
- Clear button when location selected
- Action button:
  - Empty: "Purge All" / "Fix All Addresses" / "Fix All Images" / "Fix All Videos"
  - Selected: "Purge" / "Fix Addresses" / "Fix Images" / "Fix Videos"

### 8. Function Consolidation

**Fix Addresses** (combines two existing functions):
```typescript
async function runFixAddresses(locationId?: string) {
  // Step 1: Normalize addresses
  await normalizeAddresses(locationId);
  // Step 2: Backfill regions
  await backfillRegions(locationId);
}
```

**Fix Images** (adds Live Photo detection):
```typescript
async function runFixImages(locationId?: string) {
  // Existing: thumbnail regeneration + DNG rendering
  await regenerateThumbnails(locationId);
  // Added: Live Photo detection
  await detectLivePhotos(locationId);
}
```

**Fix Videos** (adds Live Photo detection):
```typescript
async function runFixVideos(locationId?: string) {
  // Existing: video fix
  await fixVideos(locationId);
  // Added: Live Photo detection
  await detectLivePhotos(locationId);
}
```

**Purge Cache** (targets location):
```typescript
async function runPurgeCache(locationId?: string) {
  await purgeVideoProxies(locationId);
  // Optionally clear thumbnails too
}
```

### 9. Remove Items
- All `<p class="text-xs text-gray-500">` description text
- Import Options section entirely (keep only Delete on Import)
- Video Proxy Cache stats box
- Reference Maps stats box
- Standalone buttons for: Normalize Addresses, Backfill Regions, Live Photo Detection
- All gray/red/yellow button colors → replace with accent
- DatabaseSettings.svelte component (move Backup/Restore inline)

### 10. Styling
- Main accordion: Same pattern as Users accordion
- Sub-accordions: Same chevron style, indented content
- All buttons: `bg-accent text-white hover:opacity-90`
- Text links: `text-sm text-accent hover:underline`
- Modal: Clean white card with shadow, centered

---

## Files Modified

1. **Settings.svelte** - Major restructure + add location picker modal
2. **DatabaseSettings.svelte** - DELETE (functions moved inline)

---

## Implementation Order

1. Add state variables for accordions and modal
2. Create Archive accordion shell (same pattern as Users)
3. Add Archive Location row (path + edit link)
4. Add Delete on Import row (checkbox)
5. Create Maps sub-accordion with map list table
6. Create Maintenance sub-accordion with buttons
7. Create Location Picker Modal component (inline in Settings.svelte)
8. Wire up modal open/close for each repair button
9. Implement typeahead search in modal
10. Add location targeting to fix functions
11. Move backup/restore functions inline
12. Remove old standalone sections
13. Delete DatabaseSettings.svelte
14. Remove all description text
15. Test all functionality

---

## Validation Checklist

**Archive Accordion**
- [ ] Expands/collapses like Users accordion
- [ ] Archive path displays with "edit" link
- [ ] Edit opens folder picker
- [ ] Delete on Import checkbox works

**Maps Sub-Accordion**
- [ ] Shows imported maps (name, date, points)
- [ ] Delete icon removes map
- [ ] "import map" link opens file picker

**Maintenance Sub-Accordion**
- [ ] Backup Database button works
- [ ] Restore Database opens file picker

**Repair Buttons + Modal**
- [ ] Purge Cache opens location picker modal
- [ ] Fix Addresses opens location picker modal
- [ ] Fix Images opens location picker modal
- [ ] Fix Videos opens location picker modal
- [ ] Modal search shows typeahead results
- [ ] "Fix All" shown when no location selected
- [ ] "Fix" shown when location selected
- [ ] Operations work on all locations when none selected
- [ ] Operations work on single location when selected
- [ ] Fix Addresses runs normalize + backfill
- [ ] Fix Images runs thumbnails + Live Photo detection
- [ ] Fix Videos runs fix + Live Photo detection

**Styling**
- [ ] All buttons use accent color
- [ ] No description text visible
- [ ] No gray/red/yellow buttons
- [ ] Modal looks clean and on-brand
