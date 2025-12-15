# PLAN: Location Box Section Reorder + Dynamic Edit Button

**Status:** DRAFT - Awaiting User Approval
**Date:** 2025-12-10
**Affects:** LocationMapSection.svelte

---

## Requested Changes

1. **Move Address above GPS** - Swap order of sections 1 and 2
2. **Move Map above Local and Regions** - Map becomes section 3 (before Local/Region)
3. **Dynamic edit button text/color based on verification status**:
   - Red status (no GPS or no address): Show "add" in red
   - Yellow status (has data but not verified): Show "verify" in yellow
   - Green status (verified): Show "edit" in default gray

---

## Current Section Order

```
1. GPS coordinates (if hasGps)
2. Address (if hasAddress)
3. Local (county, cultural region, state direction, state)
4. Region (country cultural region, census region, country, continent)
5. Map (mini map or placeholder)
6. Edit button
```

---

## Proposed Section Order

```
1. Address (if hasAddress)        ← was #2
2. GPS coordinates (if hasGps)    ← was #1
3. Map (mini map or placeholder)  ← was #5
4. Local (county, cultural region, state direction, state)  ← was #3
5. Region (country cultural region, census region, country, continent)  ← was #4
6. Edit button (dynamic text/color)
```

---

## Implementation Plan

### Step 1: Reorder Sections in LocationMapSection.svelte

Move the HTML blocks in this order:
1. Header (stays)
2. **Address section** (move from position 2 to position 1)
3. **GPS section** (move from position 1 to position 2)
4. **Map section** (move from position 5 to position 3)
5. **Local section** (stays relative, now position 4)
6. **Region section** (stays relative, now position 5)
7. Edit button (stays at bottom)

### Step 2: Add Verification Status Logic

Add derived state to determine button text/color:

```typescript
// Determine edit button state based on verification status
const editButtonState = $derived.by((): 'add' | 'verify' | 'edit' => {
  // Check if we have GPS and Address
  const hasGpsData = hasGps;
  const hasAddressData = hasAddress;

  // Red: Missing GPS or Address
  if (!hasGpsData || !hasAddressData) {
    return 'add';
  }

  // Check verification status
  const gpsVerified = subLocation
    ? subLocation.gps_verified_on_map
    : location.gps?.verifiedOnMap === true;
  const addressVerified = location.address?.verified === true;

  // Yellow: Has data but not fully verified
  if (!gpsVerified || !addressVerified) {
    return 'verify';
  }

  // Green: Everything verified
  return 'edit';
});
```

### Step 3: Update Edit Button Styling

Change:
```svelte
<button
  onclick={handleEditClick}
  class="text-sm text-braun-500 hover:text-braun-900 hover:underline"
>
  edit
</button>
```

To:
```svelte
<button
  onclick={handleEditClick}
  class="text-sm hover:underline {editButtonState === 'add' ? 'text-gps-low' : editButtonState === 'verify' ? 'text-gps-medium' : 'text-braun-500 hover:text-braun-900'}"
  title={subLocation ? 'Edit building GPS' : 'Edit location'}
>
  {editButtonState}
</button>
```

---

## Visual Result

**Before:**
```
+------------------+
| Location         |
|                  |
| 40.7128, -74.006 |  ← GPS first
| 123 Main St, NY  |  ← Address second
| Albany County... |  ← Local
| Northeast...     |  ← Region
| [    MAP    ]    |  ← Map last
|             edit |
+------------------+
```

**After:**
```
+------------------+
| Location         |
|                  |
| 123 Main St, NY  |  ← Address first
| 40.7128, -74.006 |  ← GPS second
| [    MAP    ]    |  ← Map third
| Albany County... |  ← Local fourth
| Northeast...     |  ← Region fifth
|        add/verify/edit |  ← Dynamic button
+------------------+
```

---

## Edit Button States

| State | Condition | Text | Color |
|-------|-----------|------|-------|
| Red | Missing GPS OR missing Address | "add" | `text-gps-low` (#B85C4A) |
| Yellow | Has GPS+Address but not fully verified | "verify" | `text-gps-medium` (#C9A227) |
| Green | GPS verified AND Address verified | "edit" | `text-braun-500` (default) |

---

## Files to Modify

| File | Changes |
|------|---------|
| LocationMapSection.svelte | Reorder sections, add editButtonState logic, update button styling |

---

## Verification Checklist

After implementation, verify on:
- [ ] Location with GPS + Address (both verified) → "edit" gray
- [ ] Location with GPS + Address (not verified) → "verify" yellow
- [ ] Location with GPS only (no address) → "add" red
- [ ] Location with Address only (no GPS) → "add" red
- [ ] Location with neither → "add" red
- [ ] Sub-location page behavior matches

Check section order:
- [ ] Address appears first
- [ ] GPS appears second
- [ ] Map appears third
- [ ] Local appears fourth
- [ ] Region appears fifth

---

## Rollback Plan

Revert changes to LocationMapSection.svelte only.
No database or IPC changes required.
