# Plan: Setup Wizard Redesign

## Overview

Restructure the Setup wizard from 4 steps to 3 steps, allow PIN for single users, and update copy/styling.

## Current Structure (4 Steps)

1. **Welcome** - Introduction with features list
2. **Mode Selection** - Single/Multi user cards with emojis
3. **User Information** - Name, display name, PIN (multi-user only)
4. **Archive Location** - Folder selection, delete originals

## Proposed Structure (3 Steps)

### Step 1: Welcome
**Changes:**
- Title: "Welcome to AU Archive" → "Welcome to the Abandoned Archive!"
- Keep existing features list and intro text

### Step 2: User Setup (Combined user info + mode selection)
**Layout:**
```
Enter Your Name (first/last) *
[input field]
(note: This name will be used for copyright attribution)

Nickname (optional)
[input field]

[+ Add PIN] button (collapsed by default)
  └─> Expands to show PIN/Confirm PIN fields

[Single User]  [Multi User]  ← mode selection cards (NO emojis)

{if multi-user selected: "Add More Users" button or inline form}
```

**Changes:**
- Merge old steps 2 and 3
- Rename "Your Name" → "Enter Your Name (first/last)"
- Change note to reference copyright usage
- Rename "Display Name" → "Nickname"
- Move PIN to collapsible section available to ALL users
- Remove emojis from mode cards
- Update mode card descriptions
- Remove "All data is stored locally" footer

### Step 3: Archive Location
**Layout:**
```
Archive Location
Choose where your media files will be stored...

[path field] [Browse]

Archive Options
☐ Delete original files after import
```

**Changes:**
- Keep existing copy
- Add "Archive Options" section header above checkbox
- Remove "Import Options" header (rename to "Archive Options")

## Implementation Checklist

### File: `packages/desktop/src/pages/Setup.svelte`

1. [ ] Change `totalSteps` from 4 to 3
2. [ ] Update Step 1 title text
3. [ ] Combine Steps 2 and 3 into new Step 2:
   - [ ] Rename "Your Name" label and placeholder
   - [ ] Update note text for copyright
   - [ ] Rename "Display Name" to "Nickname"
   - [ ] Add `showPinFields` state variable (default false)
   - [ ] Add "+ Add PIN" button that toggles PIN visibility
   - [ ] Make PIN fields visible for ALL modes when toggled
   - [ ] Move mode selection (single/multi) below user fields
   - [ ] Remove emojis from mode cards
   - [ ] Update mode card descriptions
   - [ ] Add "Add More Users" button (visible when multi-user selected)
   - [ ] Add modal for adding additional users with name/nickname/PIN fields
   - [ ] Track additional users in state array
4. [ ] Renumber old Step 4 to Step 3:
   - [ ] Rename "Import Options" header to "Archive Options"
5. [ ] Remove footer "All data is stored locally" text
6. [ ] Update `canProceed()` logic for new step numbers
7. [ ] Update `completeSetup()` to:
   - [ ] Save PIN for single users too (not just multi)
   - [ ] Create all additional users from modal
8. [ ] Update `validatePin()` to work for all modes

### Logic Changes

**PIN Storage:**
- Currently: PIN only saved if `appMode === 'multi'`
- New: PIN saved for any user if provided (regardless of mode)

**Validation:**
- `canProceed()` step numbers shift (2→2 combined, 4→3)
- PIN validation applies when PIN fields are visible and have content

## Design Decisions (Confirmed)

1. **Multi-user "Add More Users"**: Modal popup - button opens modal to add additional users during setup
2. **PIN visibility**: "+ Add PIN" button toggles PIN fields visibility

## Dependencies

- No new IPC channels needed
- No database changes needed (PIN storage already supports all users)
- No new components needed

## Testing

- [ ] Fresh setup as single user without PIN
- [ ] Fresh setup as single user with PIN
- [ ] Fresh setup as multi-user without PIN
- [ ] Fresh setup as multi-user with PIN
- [ ] Verify copyright name appears correctly after setup
- [ ] Verify PIN login works for single-user mode
