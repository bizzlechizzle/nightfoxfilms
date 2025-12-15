# PLAN: Title Box Edit Button

**Status:** Reverted (user rejected - too messy, detracts from title box)
**Author:** Claude
**Date:** 2025-12-10
**Scope:** LocationDetail, SubLocationDetail, HostLocationDetail pages

---

## Overview

Add an edit button to the lower-right corner of the Index Card Header (title box) on all location page types. This edit button opens a focused modal for editing core identity fields: Name, Type, and Sub-Type.

---

## Current State

The Index Card Header (lines 956-1048 in `LocationDetail.svelte`) contains:
- **Left:** Hero thumbnail (4:1 aspect ratio, 288px)
- **Right:** Title text right-aligned with:
  - Location/Building name (h1, 5xl font)
  - Status + Sub-Type line
  - Built/Abandoned years
  - Buildings list (host locations) or siblings (sub-locations)

Currently, editing Name/Type/Sub-Type requires opening the LocationInfo edit modal, which contains 15+ fields. This plan adds a quick-access edit for the most common identity edits.

---

## Proposed Changes

### 1. Add Edit Button to Title Box

**Position:** Lower-right corner of the Index Card content area (inside the flex container, after the title/metadata block)

**Visual Design (Braun-compliant):**
```css
/* Ghost button style - matches existing "edit" links */
.title-edit-btn {
  font-size: 13px;           /* Caption size */
  font-weight: 400;          /* Regular */
  color: #5C5C58;            /* Secondary text */
  padding: 4px 8px;          /* Minimal padding */
  border: none;
  background: transparent;
  cursor: pointer;
  transition: color 0.15s ease;
}
.title-edit-btn:hover {
  color: #1C1C1A;            /* Primary text */
  text-decoration: underline;
}
```

**Layout Change:**
- Wrap existing content in a flex column with `justify-between`
- Edit button anchored to bottom-right

### 2. New Modal: Title Edit Modal

**Modal Fields:**

| Field | Label (Location) | Label (Sub-Location) | Input Type |
|-------|------------------|---------------------|------------|
| Name | Location Name | Building Name | Text input |
| Type | Location Type | Building Type | Autocomplete (datalist) |
| Sub-Type | Location Sub-Type | Building Sub-Type | Autocomplete (datalist) |

**Modal Design (Braun-compliant):**
- Width: `max-w-md` (smaller than LocationInfo modal)
- Header: "Edit Title" with close (X) button
- Content: 3 form fields, 16px gap between fields
- Footer: Cancel (ghost) + Save (primary) buttons, right-aligned
- Backdrop: `bg-black/50`, click to close
- Escape key closes modal

### 3. Page-Type Behavior

| Page Type | Name Field | Type/Sub-Type Source | Save Target |
|-----------|------------|---------------------|-------------|
| Regular Location | `location.locnam` | `location.type`, `location.stype` | `location:update` |
| Host Location | `location.locnam` | `location.type`, `location.stype` | `location:update` |
| Sub-Location (Building) | `currentSubLocation.subnam` | `currentSubLocation.type`, `currentSubLocation.stype` | `sublocation:update` |

### 4. Autocomplete Options

Reuse existing type/sub-type options loaded by LocationInfo:
- Type options from `location:getTypes` IPC
- Sub-Type options from `location:getSubTypes` IPC

---

## Braun Design Verification Checklist

| Check | Status | Notes |
|-------|--------|-------|
| Color palette | Pass | Uses `braun-500` secondary, `braun-900` on hover |
| Typography | Pass | 13px regular (caption size) |
| 8pt grid | Pass | 4px/8px padding (fine adjustment allowed) |
| Border radius | Pass | 4px on modal, no radius on button |
| Button style | Pass | Ghost button matches existing "edit" links |
| No decorative elements | Pass | Plain text "edit" link |
| Modal pattern | Pass | Matches LocationInfo modal exactly |
| Minimal | Pass | Only 3 essential fields |

---

## Implementation Steps

1. **Add state variables** in LocationDetail.svelte:
   - `showTitleEditModal: boolean`
   - `titleEditForm: { name, type, stype }`

2. **Add edit button** inside Index Card flex container:
   - Position: bottom-right of the right content area
   - Text: "edit" (lowercase, matches existing pattern)

3. **Add Title Edit Modal markup**:
   - Reuse modal pattern from LocationInfo
   - 3 form fields with existing input styles
   - Save handler calls appropriate IPC based on page type

4. **Load autocomplete options**:
   - Fetch type/sub-type options on mount (or reuse if already loaded)

5. **Handle save**:
   - Location mode: call `window.electron.location.update()`
   - Sub-location mode: call `window.electron.subLocation.update()`
   - Refresh location data after save

---

## Files to Modify

| File | Changes |
|------|---------|
| `packages/desktop/src/pages/LocationDetail.svelte` | Add state, edit button, modal markup, save handlers |

No new files needed. All changes contained in single file.

---

## Visual Mockup (ASCII)

```
┌─────────────────────────────────────────────────────────────────┐
│  ┌──────────┐                                                   │
│  │          │                                                   │
│  │  HERO    │                        Riverside State Hospital   │
│  │  4:1     │                         Active · Psychiatric      │
│  │          │                         Est. 1890 · Closed 1996   │
│  └──────────┘                         Main · Admin · Chapel     │
│                                                            edit │
└─────────────────────────────────────────────────────────────────┘
```

**Edit button position:** Flush right, below the last line of metadata

---

## Questions for User

None - scope is clear. Awaiting approval to proceed.

---

## Approval

- [ ] User approves plan
- [ ] Ready for implementation
