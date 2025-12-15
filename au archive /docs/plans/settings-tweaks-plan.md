# Settings Area Tweaks Plan

## Objective
Refine the Archive accordion layout: default accordions closed, add PIN protection for sensitive settings, restructure Maps/Maintenance as flat rows with dropdowns, and reorganize database buttons.

---

## User Requirements Analysis

| # | Requirement | Interpretation |
|---|-------------|----------------|
| 1 | Default accordions are closed | Change `archiveExpanded`, `mapsExpanded`, `maintenanceExpanded` initial state to `false` |
| 2 | Delete on Import needs edit button | Add "edit" text link next to checkbox (like Archive Location row) |
| 3 | Edit buttons require user PIN | Both Archive Location and Delete on Import "edit" buttons must verify PIN before allowing changes |
| 4 | Maps and Maintenance not in bubble | Remove border/rounded-lg wrapper from Maps and Maintenance sub-accordions; make them flat rows like Archive Location and Delete on Import |
| 5 | Maps and Maintenance still have dropdown | Keep chevron/expand behavior, just remove the bordered box styling |
| 6 | Move Restore Database next to Backup | Group Backup + Restore buttons together at top of Maintenance; remove Restore from Repair section |

---

## Target Layout

```
Archive                                                        {v} (closed by default)

Archive Location                    /path/to/archive           [edit] (requires PIN)
Delete on Import                    On/Off                     [edit] (requires PIN)
Maps                                                           {v} (closed by default)
    map-file-1.kml             2024-01-15        1,234 points  [x]
    map-file-2.gpx             2024-02-20          567 points  [x]
                                                        [import map]
Maintenance                                                    {v} (closed by default)
    [Backup Database]  [Restore Database]

    Repair
    [Purge Cache] [Fix Addresses] [Fix Images] [Fix Videos]
```

Key visual changes:
- All 4 rows (Archive Location, Delete on Import, Maps, Maintenance) are at same indent level
- Maps and Maintenance are just labeled rows with chevrons (no bordered box)
- When expanded, their content appears indented below
- Restore Database moved next to Backup Database

---

## Changes Required

### 1. State Variable Defaults
```typescript
// Change from true to false
let archiveExpanded = $state(false);
let mapsExpanded = $state(false);
let maintenanceExpanded = $state(false);

// Add PIN verification state
let showPinModal = $state(false);
let pinAction = $state<'archive' | 'deleteOnImport' | null>(null);
let pinInput = $state('');
let pinError = $state('');
let pinVerifying = $state(false);
```

### 2. Delete on Import Row
- Add "edit" text link similar to Archive Location
- Current: checkbox that directly toggles value
- New: display "On" / "Off" text + "edit" link that requires PIN

### 3. PIN Verification Modal
Create a simple PIN input modal that:
- Appears when user clicks "edit" on Archive Location or Delete on Import
- Has 4-6 digit PIN input field
- Verifies against `window.electronAPI.users.verifyPin(currentUserId, pin)`
- If no user has PIN set, skip verification (allow edit directly)
- On success: proceed with the edit action (folder picker or toggle checkbox)
- On failure: show error message

### 4. Maps Sub-Accordion Restyling
Remove: `<div class="border border-gray-200 rounded-lg overflow-hidden">`
Keep: Button with chevron + expanded content
Make it look like a flat row with border-bottom (like Archive Location row)

### 5. Maintenance Sub-Accordion Restyling
Same treatment as Maps - remove bordered box, make flat row

### 6. Maintenance Button Reorganization
Current order:
- Backup Database (standalone)
- Repair: Purge Cache, Restore Database, Fix Addresses, Fix Images, Fix Videos

New order:
- Database: [Backup Database] [Restore Database]
- Repair: [Purge Cache] [Fix Addresses] [Fix Images] [Fix Videos]

---

## Implementation Order

1. Change default state values to `false` for all accordions
2. Add PIN verification state variables
3. Create PIN verification modal template
4. Add PIN verification helper functions
5. Modify Archive Location "edit" to require PIN
6. Modify Delete on Import row to show value + "edit" link with PIN
7. Remove bordered box styling from Maps sub-accordion
8. Remove bordered box styling from Maintenance sub-accordion
9. Reorganize Maintenance buttons (Backup + Restore together, then Repair)
10. Test all functionality

---

## Validation Checklist

**Default States**
- [ ] Archive accordion closed by default
- [ ] Maps sub-accordion closed by default
- [ ] Maintenance sub-accordion closed by default

**PIN Protection**
- [ ] Archive Location "edit" prompts for PIN (if user has PIN)
- [ ] Delete on Import "edit" prompts for PIN (if user has PIN)
- [ ] PIN modal shows error on wrong PIN
- [ ] Skip PIN if no user has PIN set
- [ ] After successful PIN, action proceeds (folder picker / toggle)

**Visual Layout**
- [ ] Maps row is flat (no bordered box)
- [ ] Maintenance row is flat (no bordered box)
- [ ] All 4 rows at same indent level inside Archive accordion
- [ ] Delete on Import shows "On" / "Off" + "edit" link

**Button Organization**
- [ ] Backup Database and Restore Database are side-by-side
- [ ] Restore Database removed from Repair section
- [ ] Repair section has 4 buttons: Purge Cache, Fix Addresses, Fix Images, Fix Videos

---

## Files Modified

1. **Settings.svelte** - All changes in this single file

---

## Audit Against CLAUDE.md

| Rule | Compliance |
|------|------------|
| Scope Discipline | Only implementing requested changes |
| Keep It Simple | Minimal changes, reusing existing patterns |
| No Over-Engineering | Simple PIN modal, no new components |
| Archive-First | Settings protect archive configuration |

## Audit Against User Prompt

| Requirement | Addressed |
|-------------|-----------|
| Default accordions closed | Yes - changing initial state values |
| Delete on Import edit button | Yes - adding "edit" link |
| Edit buttons require PIN | Yes - PIN verification modal |
| Maps/Maintenance not in bubble | Yes - removing bordered styling |
| Maps/Maintenance still have dropdown | Yes - keeping chevron expand |
| Restore next to Backup | Yes - reorganizing buttons |

**PLAN APPROVED - Ready to implement**
