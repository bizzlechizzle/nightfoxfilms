# Settings Page Cleanup v2 Plan

## Objective
Simplify Settings page: remove subtitle text, ensure all accordions start collapsed, consolidate Archive Location/Delete on Import/Startup PIN into edit-only buttons, reduce maintenance button sizes, and move "Require PIN on startup" from Users to Archive box.

---

## User Requirements Analysis

| # | Requirement | Interpretation |
|---|-------------|----------------|
| 1.1 | Remove "Configure application preferences" | Delete the `<p>` subtitle below "Settings" header |
| 1.2 | Accordions always collapsed | Change `usersExpanded` initial state from `true` to `false` |
| 2.1 | Archive Location - remove label, leave edit button + path | Format: `[edit] /Volumes/abandoned/archive` |
| 2.2 | Delete on Import - remove label, leave edit button + value | Format: `[edit] On` or `[edit] Off` |
| 2.3 | Lower button size in Maintenance and Repair | Reduce from `px-4 py-2` to `px-3 py-1.5 text-sm` |
| 2.4 | Move "Require PIN on startup" to Archive box with edit button | Remove from Users section, add to Archive with same format |

---

## Current State

### Settings Header (line 1393)
```svelte
<h1 class="text-3xl font-bold text-foreground mb-2">Settings</h1>
<p class="text-gray-600">Configure application preferences</p>  <!-- REMOVE -->
```

### Users Accordion (line 51)
```typescript
let usersExpanded = $state(true);  // Change to false
```

### Require PIN in Users Section (lines 1567-1577)
Currently a checkbox with label inside Users accordion. Will be moved to Archive box.

### Archive Location Row (lines 1682-1694)
Current: `Archive Location    /path    [edit]`
Target: `[edit]  /path/to/archive`

### Delete on Import Row (lines 1697-1709)
Current: `Delete on Import    On/Off    [edit]`
Target: `[edit]  On` or `[edit]  Off`

### Maintenance Buttons (lines 1790-1848)
Current: `class="px-4 py-2 bg-accent..."`
Target: `class="px-3 py-1.5 text-sm bg-accent..."`

---

## Target Layout

```
Settings                                                      v0.1.0

Users                                                              {v} (collapsed)
    [user list]
    [add user]                                    <-- Require PIN removed from here

Archive                                                            {v} (collapsed)
    [edit]  /Volumes/abandoned/archive
    [edit]  On                                    <-- Delete on Import value
    [edit]  On                                    <-- Startup PIN value (NEW)
    Maps                                                           {v}
    Maintenance                                                    {v}
        [Backup Database]  [Restore Database]   <-- smaller buttons
        Repair
        [Purge Cache] [Fix Addresses] [Fix Images] [Fix Videos]  <-- smaller
```

---

## Changes Required

### 1. Remove Subtitle Text
- Line 1393: Delete `<p class="text-gray-600">Configure application preferences</p>`

### 2. Users Accordion Default Collapsed
- Line 51: Change `let usersExpanded = $state(true);` to `let usersExpanded = $state(false);`

### 3. Archive Location Row - Edit Button + Path Only
- Remove "Archive Location" label span
- Format: `[edit]  /path/to/archive`

### 4. Delete on Import Row - Edit Button + Value Only
- Remove "Delete on Import" label span
- Format: `[edit]  On` or `[edit]  Off`

### 5. Add Startup PIN Row to Archive Box
- Add new row after Delete on Import with same format
- Format: `[edit]  On` or `[edit]  Off`
- Use `toggleRequireLogin()` function (already exists)
- No PIN verification needed (just toggles the setting)

### 6. Remove Require PIN from Users Section
- Delete the checkbox + label from the "Require PIN and Add User row"
- Keep only the "add user" button in that row

### 7. Reduce Maintenance/Repair Button Sizes
- Change all 6 buttons from `px-4 py-2` to `px-3 py-1.5 text-sm`

---

## Implementation Order

1. Remove subtitle text from header
2. Change `usersExpanded` default to `false`
3. Simplify Archive Location row (edit + path only)
4. Simplify Delete on Import row (edit + value only)
5. Add Startup PIN row to Archive box (after Delete on Import)
6. Remove Require PIN checkbox from Users section
7. Reduce Maintenance button sizes
8. Reduce Repair button sizes
9. Build and verify

---

## Validation Checklist

**Header**
- [ ] No "Configure application preferences" subtitle
- [ ] "Settings" and "v0.1.0" remain

**Accordions**
- [ ] Users accordion collapsed by default
- [ ] Archive accordion collapsed by default (already done)

**Archive Box - Three Settings Rows**
- [ ] Archive Location shows: `[edit] /path/to/archive`
- [ ] Delete on Import shows: `[edit] On` or `[edit] Off`
- [ ] Startup PIN shows: `[edit] On` or `[edit] Off`
- [ ] No labels visible
- [ ] Archive Location and Delete on Import edit buttons still require PIN
- [ ] Startup PIN edit button toggles directly (no PIN verification)

**Users Section**
- [ ] "Require PIN on startup" checkbox removed
- [ ] "add user" button remains

**Buttons**
- [ ] All Maintenance/Repair buttons are smaller
- [ ] Button text readable at smaller size
- [ ] Functionality unchanged

---

## Files Modified

1. **Settings.svelte** - All changes in this single file

---

## Audit Against CLAUDE.md

| Rule | Compliance |
|------|------------|
| Scope Discipline | Only implementing requested changes |
| Keep It Simple | Minimal changes, moving existing functionality |
| No Over-Engineering | Reusing existing `toggleRequireLogin()` function |
| Archive-First | Settings centralized in Archive box |

## Audit Against User Prompt

| Requirement | Addressed |
|-------------|-----------|
| Remove "Configure application preferences" | Yes - deleting subtitle |
| Accordions always collapsed | Yes - changing usersExpanded to false |
| Archive Location - edit button only | Yes - format: [edit] /path |
| Delete on Import - edit button only | Yes - format: [edit] On/Off |
| Lower button size in maintenance/repair | Yes - px-3 py-1.5 text-sm |
| Move Startup PIN to Archive with edit button | Yes - new row after Delete on Import |

---

**READY FOR USER APPROVAL**
