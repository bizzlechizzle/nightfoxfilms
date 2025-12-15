# Issue Tracking: DECISION-014

**Status**: In Progress
**Opened**: 2025-11-24
**Priority**: P0 (Critical)

---

## CRITICAL: GPS Ghost Assignment Violation

### Problem
`LocationDetail.svelte:312` calls `await ensureGpsFromAddress();` on page load. This automatically geocodes addresses to create GPS coordinates WITHOUT user confirmation.

**Contract Violation** (from `docs/contracts/gps.md`):
> "Higher-confidence data overwrites lower tiers only after user confirmation; automated processes may only promote, never demote."

### Root Cause
The `ensureGpsFromAddress()` function in `onMount` auto-runs cascade geocoding when a location has an address but no GPS. This creates "ghost GPS" that:
- Bypasses user confirmation
- Assigns low-confidence coordinates automatically
- Violates the GPS contract's user-confirmation requirement

### Resolution
- [x] Remove `await ensureGpsFromAddress();` from onMount (line 312)
- [x] Keep the function available for manual user-triggered geocoding if needed later

---

## Phase 3: UI Verification Audit

### Issue 1: Remove Verification Checkmarks from Location Box
**File**: `packages/desktop/src/components/location/LocationMapSection.svelte`
**Lines**: 111-115, 132-136, 196-200, 258-262

Per user request, remove all ✓/✗ verification indicators from:
- Location header (line 111-115)
- Mailing Address section (lines 132-136)
- GPS section (lines 196-200)
- Area section (lines 258-262)

- [x] Remove verification checkmarks from all 4 sections

### Issue 2: LocationHeader Updates
**File**: `packages/desktop/src/components/location/LocationHeader.svelte`

- [x] Remove favorite button (lines 30-45) - already exists in LocationInfo
- [x] Add drop shadow to h1 title

---

## Coding Plan

### Step 1: Update issuetracking.md (this file)
Document all issues and changes

### Step 2: Fix LocationDetail.svelte
```svelte
// BEFORE (line 309-315):
onMount(async () => {
  await loadLocation();
  loadBookmarks();
  await ensureGpsFromAddress(); // Kanye6 <-- REMOVE THIS
  try { const settings = await window.electronAPI.settings.getAll(); ...

// AFTER:
onMount(async () => {
  await loadLocation();
  loadBookmarks();
  // ensureGpsFromAddress removed - GPS should only come from EXIF or user action
  try { const settings = await window.electronAPI.settings.getAll(); ...
```

### Step 3: Fix LocationMapSection.svelte
Remove all verification checkmark blocks:
- Lines 111-115: Location header checkmark
- Lines 132-136: Address section checkmark
- Lines 196-200: GPS section checkmark
- Lines 258-262: Area section checkmark

### Step 4: Fix LocationHeader.svelte
- Remove favorite button (lines 30-45)
- Add `drop-shadow-md` or equivalent to h1

### Step 5: Build and Verify
```bash
pnpm build
pnpm dev
```

### Step 6: User Review
Present changes for review before closing ticket

---

## Audit Against claude.md

| Rule | Status | Finding |
|------|--------|---------|
| GPS confidence ladder | FIXED | Auto-geocoding removed from onMount |
| Scope Discipline | OK | Only fixing identified issues |
| Archive-First | OK | Preserving EXIF-first GPS policy |
| Offline-First | OK | All changes local |
| Keep It Simple | OK | Removing complexity, not adding |

---

## Previous Decisions (Reference)
- DECISION-013: Location Page Redesign Phase 2
- DECISION-012: Region auto-population
- DECISION-011: Location box redesign
- DECISION-010: GPS adoption logic
- DECISION-009: Location detail unified layout
- DECISION-008: GPS mismatch confidence
- DECISION-007: State autocomplete refactor
