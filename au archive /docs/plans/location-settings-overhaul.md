# Location Settings Overhaul - Comprehensive Plan

## Task Requirements

### 1. Simplify Settings Page Thumbnail Maintenance
**Current (3 buttons with verbose descriptions):**
- "Regenerate Missing" + description
- "Fix All Rotations" + description
- "Fix DNG Quality" + description

**New (2 simple buttons):**
- "Fix Images" - combines all image thumbnail operations
- "Fix Videos" - handles video poster frames + proxies

### 2. Add Location Settings Section to LocationDetail
**Location:** Bottom of Nerd Stats (collapsed by default)

**PIN-protected:** Enter PIN once to unlock all buttons for session

**Buttons:**
- Fix Images (location-specific)
- Fix Videos (location-specific)
- Edit Location (opens existing edit modal)
- Delete Location (simple confirmation after PIN)

---

## Current State Analysis

### Settings.svelte Thumbnail Buttons (Lines 1005-1048)
```
┌─────────────────────────────────────────────┐
│ Thumbnail Maintenance                        │
├─────────────────────────────────────────────┤
│ [Regenerate Missing]                         │
│ "Regenerate thumbnails for images..."        │
│                                              │
│ [Fix All Rotations]                          │
│ "Regenerate Missing processes only..."       │
│                                              │
│ [Fix DNG Quality]                            │
│ "Fix DNG Quality uses LibRaw..."             │
└─────────────────────────────────────────────┘
```

### LocationNerdStats.svelte (Current)
- Identifiers, Timestamps, Activity, GPS, Media Stats, Classification
- NO settings/actions section
- NO PIN protection

### Delete Location
- API exists (`location:delete`)
- NO UI button
- NO PIN protection
- NO confirmation dialog

---

## Proposed Changes

### Part 1: Simplify Settings Page

**Replace 3 buttons with 2:**

```
┌─────────────────────────────────────────────┐
│ Media Maintenance                            │
├─────────────────────────────────────────────┤
│ [Fix Images]        [Fix Videos]             │
│                                              │
│ Repairs thumbnails, rotations, and previews  │
└─────────────────────────────────────────────┘
```

**"Fix Images" button runs sequentially:**
1. Regenerate missing thumbnails
2. Fix rotations (force regenerate)
3. Fix DNG quality (LibRaw)

**"Fix Videos" button:**
1. Regenerate missing poster frames
2. (Future: video proxy regeneration)

### Part 2: Location Settings Section

**Add to bottom of LocationNerdStats:**

```
┌─────────────────────────────────────────────┐
│ ▼ Location Settings                          │
├─────────────────────────────────────────────┤
│ 🔒 Enter PIN to unlock                       │
│ [____] [Unlock]                              │
├─────────────────────────────────────────────┤
│ (After PIN verified - unlocked for session)  │
│                                              │
│ [Fix Images]  [Fix Videos]  [Edit Location]  │
│                                              │
│ [Delete Location]                            │
└─────────────────────────────────────────────┘
```

### Part 3: PIN Protection Flow

**Single unlock for session:**
1. User expands Location Settings
2. PIN input field shown
3. User enters PIN and clicks Unlock
4. If valid: all buttons enabled for this page session
5. If invalid: show error, stay locked
6. Navigating away re-locks (must re-enter PIN)

### Part 4: Delete Location with Warning

**Flow (PIN already entered):**
1. User clicks "Delete Location"
2. Simple confirmation dialog:
   ```
   ⚠️ Delete "[Location Name]"?

   This action cannot be undone.
   Media files will remain on disk.

   [Cancel]  [Delete]
   ```
3. Execute deletion
4. Redirect to /locations

---

## Files to Modify

### 1. `src/pages/Settings.svelte`
- Replace 3 thumbnail buttons with "Fix Images" and "Fix Videos"
- Remove verbose descriptions
- Combine operations into single functions

### 2. `src/components/location/LocationNerdStats.svelte`
- Add "Location Settings" collapsible section at bottom
- Add PIN unlock UI (input + button)
- Add `settingsUnlocked` state
- Add Fix Images/Videos buttons (location-specific)
- Add Edit Location button (opens existing modal)
- Add Delete Location button with confirmation dialog

### 3. `electron/main/ipc-handlers/media-processing.ts`
- Add location-specific thumbnail regeneration handler
- `media:fixLocationImages(locid)` - thumbnails + rotations + DNG for location
- `media:fixLocationVideos(locid)` - poster frames + proxies for location

### 4. `electron/preload/preload.cjs`
- Add `media.fixLocationImages(locid)`
- Add `media.fixLocationVideos(locid)`

### 5. `src/types/electron.d.ts`
- Add TypeScript types for new IPC methods

---

## New IPC Handlers Needed

```typescript
// Location-specific media fixes
'media:fixLocationImages': (locid) => Promise<{fixed: number, errors: number}>
'media:fixLocationVideos': (locid) => Promise<{fixed: number, errors: number}>
```

---

## CLAUDE.md Compliance Audit

| Rule | Status | Notes |
|------|--------|-------|
| Scope Discipline | ✅ | Only implementing requested features |
| Keep It Simple | ✅ | Reducing 3 buttons to 2, clean UI |
| Archive-First | ✅ | Protects data with PIN + confirmation |
| Offline-First | ✅ | All operations are local |
| No AI in Docs | ✅ | No AI mentions in UI |

---

## Testing Checklist

### Settings Page
- [ ] "Fix Images" button works (runs all 3 operations)
- [ ] "Fix Videos" button works
- [ ] Progress indicators show correctly
- [ ] Verbose descriptions removed

### Location Settings
- [ ] Section appears at bottom of Nerd Stats
- [ ] Section is collapsed by default
- [ ] PIN modal appears for all actions
- [ ] Wrong PIN shows error
- [ ] Correct PIN allows action

### Fix Images/Videos (Location-Specific)
- [ ] Only processes media for that location
- [ ] Progress shows correctly
- [ ] Errors handled gracefully

### Edit Type/Name
- [ ] Opens edit modal
- [ ] Changes save correctly
- [ ] Updates reflected in UI

### Delete Location
- [ ] PIN required first
- [ ] Warning dialog shows after PIN
- [ ] Must type "DELETE" to confirm
- [ ] Location removed from database
- [ ] Redirects to Locations list after delete
- [ ] Media files remain on disk (only links removed)

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Accidental deletion | High | PIN + type "DELETE" confirmation |
| Media orphaned | Low | Files stay on disk, only DB links removed |
| PIN bypass | Medium | All buttons require PIN verification |

---

## Implementation Order

1. Settings.svelte - Simplify to 2 buttons
2. Add location-specific IPC handlers
3. Update preload.cjs
4. Add Location Settings section to LocationNerdStats
5. Add PIN modal component
6. Add Delete confirmation dialog
7. Test all flows
8. Write implementation guide
