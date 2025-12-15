# Verification Scoring Audit & Fix

## Problem Statement

"michell autoparts" shows YELLOW verification status when it should show RED.

**Current behavior:** Location has fully verified GPS + Address (100% Location score), but missing Category/Class/Status (0% Information score). The overall color shows YELLOW based only on Location data.

**Expected behavior:** Overall score should be 30/100 (only Location contributes), which falls in the RED range (0-80%).

---

## Master Verification Logic (USER SPEC)

### Total Weight Distribution
| Component | Weight |
|-----------|--------|
| Information | 70% |
| Location | 30% |
| **TOTAL** | **100%** |

### Color Thresholds
| Overall Score | Color |
|---------------|-------|
| 0% - 80% | RED |
| 80% - 100% (exclusive) | YELLOW |
| 100% | GREEN |

---

## Individual Component Scoring

### Information Box (70% of total)

| State | Component Score | Condition |
|-------|-----------------|-----------|
| **RED (0%)** | 0% | Missing ANY of: Category, Class, Status |
| **GREEN (100%)** | 100% | Has ALL of: Category, Class, Status |

**UI Indicators:**
- Red "add" button in Information Box when 0%
- Red "verify location" link in Title Box when Information is 0%
- Green "edit" button when 100%

### Location Box (30% of total)

| State | Component Score | Condition |
|-------|-----------------|-----------|
| **RED (0%)** | 0% | Missing GPS OR missing Address |
| **YELLOW (80%)** | 80% | Has GPS AND Address (but not both verified) |
| **GREEN (100%)** | 100% | GPS verified checkmark AND Address verified checkmark |

**UI Indicators:**
- Red "add" button when 0%
- Yellow "verify" button when 80%
- Gray "edit" button when 100%

---

## Example Calculations

### Example 1: "michell autoparts" (THE BUG)
- Information: 0% (missing category/class/status)
- Location: 100% (both GPS + Address verified)
- **Total: (0% × 70%) + (100% × 30%) = 0% + 30% = 30%**
- **Color: RED** (30% is in 0-80% range)

### Example 2: Complete location with unverified data
- Information: 100% (has category, class, status)
- Location: 80% (has GPS + Address, not verified)
- **Total: (100% × 70%) + (80% × 30%) = 70% + 24% = 94%**
- **Color: YELLOW** (94% is in 80-100% range)

### Example 3: Fully verified location
- Information: 100% (has category, class, status)
- Location: 100% (both verified)
- **Total: (100% × 70%) + (100% × 30%) = 70% + 30% = 100%**
- **Color: GREEN** (exactly 100%)

### Example 4: Missing GPS, complete information
- Information: 100% (has category, class, status)
- Location: 0% (missing GPS)
- **Total: (100% × 70%) + (0% × 30%) = 70% + 0% = 70%**
- **Color: RED** (70% is in 0-80% range)

### Example 5: Partial information, unverified location
- Information: 0% (missing category)
- Location: 80% (has GPS + Address, not verified)
- **Total: (0% × 70%) + (80% × 30%) = 0% + 24% = 24%**
- **Color: RED** (24% is in 0-80% range)

---

## Current Implementation (BROKEN)

### File: `LocationDetail.svelte` (lines 101-126)

```typescript
const verificationStatus = $derived.by((): 'green' | 'yellow' | 'red' => {
  // ONLY checks GPS and Address - IGNORES Information scoring
  const hasGps = location.gps?.lat != null && location.gps?.lng != null;
  const hasAddress = !!(location.address?.city || location.address?.state);
  const gpsVerified = location.gps?.verifiedOnMap === true;
  const addressVerified = location.address?.verified === true;

  if (gpsVerified && addressVerified) return 'green';  // WRONG: 30% max
  if (hasGps && hasAddress) return 'yellow';            // WRONG: 24% max
  return 'red';
});
```

**Bug:** This only considers Location data (30% max), completely ignoring Information (70%).

---

## Files Requiring Changes

### 1. `packages/desktop/src/pages/LocationDetail.svelte`

**Changes needed:**
- Update `verificationStatus` calculation to use weighted scoring (lines 101-126)
- Add derived values for Information completeness
- Calculate overall score: `(infoScore × 0.70) + (locationScore × 0.30)`
- Apply color thresholds: 0-80% = red, 80-100% = yellow, 100% = green
- Update status line tooltip (lines 1108-1110) to explain weighted scoring
- Fix SubLocation interface to add `class` field (line 40)

**Current location:** Lines 101-126, 1104-1111

**Tooltip update needed:**
```
Current: "GPS and Address verified" / "Has GPS and Address" / "Missing GPS or Address"
New: "Fully verified (100%)" / "Partially complete (80-99%)" / "Incomplete (0-79%)"
```

### 2. `packages/desktop/src/components/location/LocationInfo.svelte`

**Current state (CORRECT):**
- `isInfoComplete = hasStatus && hasCategory && hasClass` (line 183)
- Red "add" when incomplete, Green "edit" when complete (lines 188-193)

**Changes needed:** None - Individual component scoring is correct.

### 3. `packages/desktop/src/components/location/LocationMapSection.svelte`

**Current state (NEEDS UPDATE):**
- Red when missing GPS OR Address (correct = 0%)
- Yellow when has data but not verified (correct = 80%)
- Gray when fully verified (should be GREEN = 100%)

**Changes needed:**
- Change "gray" edit button to "green" when fully verified (consistency with spec)
- Line 161: `return { text: 'edit', colorClass: 'text-braun-500...' }` → should use `text-gps-verified`

### 4. Title Box in `LocationDetail.svelte`

**Current state (lines 1061-1065):**
```svelte
{#if !location.access && !location.class && !location.category}
  <button onclick={openVerifyModal} class="text-error hover:underline cursor-pointer">verify location</button>
{/if}
```

**Analysis:** This shows "verify location" when Information is incomplete (0%). This is CORRECT per spec.

**Changes needed:** None - this correctly shows when Information is at 0%.

---

## Implementation Plan

### Step 1: Update LocationDetail.svelte verificationStatus

Replace the current `verificationStatus` calculation with weighted scoring:

```typescript
// Information scoring (70% weight)
const hasCategory = $derived(!!location?.category);
const hasClass = $derived(!!location?.class);
const hasStatus = $derived(!!location?.access);
const infoScore = $derived(hasCategory && hasClass && hasStatus ? 100 : 0);

// Location scoring (30% weight)
const hasGps = $derived(location?.gps?.lat != null && location?.gps?.lng != null);
const hasAddress = $derived(!!(location?.address?.city || location?.address?.state));
const gpsVerified = $derived(location?.gps?.verifiedOnMap === true);
const addressVerified = $derived(location?.address?.verified === true);

const locationScore = $derived.by(() => {
  if (!hasGps || !hasAddress) return 0;    // Missing data = 0%
  if (!gpsVerified || !addressVerified) return 80;  // Has data, not verified = 80%
  return 100;  // Fully verified = 100%
});

// Overall weighted score
const overallScore = $derived((infoScore * 0.70) + (locationScore * 0.30));

// Color based on overall score
const verificationStatus = $derived.by((): 'green' | 'yellow' | 'red' => {
  if (overallScore >= 100) return 'green';
  if (overallScore >= 80) return 'yellow';
  return 'red';
});
```

### Step 2: Update LocationMapSection.svelte edit button color

Change gray to green for fully verified state:

```typescript
// Line 161: Change from gray to green
return { text: 'edit', colorClass: 'text-gps-verified hover:text-braun-900' };
```

### Step 3: Test cases to verify

| Test Case | Info | Location | Expected Score | Expected Color |
|-----------|------|----------|----------------|----------------|
| michell autoparts | 0% | 100% | 30% | RED |
| Full but unverified | 100% | 80% | 94% | YELLOW |
| Fully complete | 100% | 100% | 100% | GREEN |
| Missing GPS only | 100% | 0% | 70% | RED |
| Missing category only | 0% | 100% | 30% | RED |
| Empty location | 0% | 0% | 0% | RED |

---

## Affected Components Summary

| Component | File | Current State | Action |
|-----------|------|---------------|--------|
| Overall Status | LocationDetail.svelte | BROKEN (Location only) | FIX: Add weighted scoring |
| Information Box | LocationInfo.svelte | CORRECT | None |
| Location Box | LocationMapSection.svelte | MOSTLY CORRECT | FIX: Gray → Green for verified |
| Title Box | LocationDetail.svelte | CORRECT | None |

---

## Sub-Location Considerations

**USER DECISION:** Information scoring ALWAYS uses HOST location fields.

When viewing a sub-location (building):
- **Information (70%):** From HOST location's category/class/status (campus-level metadata)
- **Location (30%):** GPS from sub-location, Address from host location

This means:
- A building inherits its host's Information completeness
- Each building has its own GPS verification status
- Address is shared across all buildings on a campus

### Sub-Location Interface Fix Needed

The `SubLocation` interface in LocationDetail.svelte is missing the `class` field that's accessed in LocationInfo.svelte:336. Add:

```typescript
interface SubLocation {
  // ... existing fields
  class: string | null;  // Migration 65: Sub-location class (Building Class)
}
```

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Breaking existing green/yellow/red display | Test with multiple locations |
| Sub-location GPS handling | Preserve existing sub-location GPS logic |
| Color class mismatches | Use existing Tailwind GPS color classes |

---

## Definition of Done

1. [ ] `verificationStatus` uses weighted scoring (70% info + 30% location)
2. [ ] "michell autoparts" shows RED (score = 30%)
3. [ ] Location Box shows GREEN (not gray) when fully verified
4. [ ] All test cases pass expected colors
5. [ ] Sub-location viewing uses HOST location's category/class/status for Information
6. [ ] Sub-location viewing uses building's GPS for Location scoring
7. [ ] Status line tooltip updated to explain weighted scoring
8. [ ] SubLocation interface includes `class` field
