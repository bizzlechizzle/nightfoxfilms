# Plan: Verification Status Line

## Request

Add a thin colored horizontal line below the title (in the Index Card Header) but above the LocationMapSection, indicating verification status.

## Verification Logic

| Status | Color | Condition |
|--------|-------|-----------|
| **Green** | `#4A8C5E` | GPS verified (`gps?.verifiedOnMap`) AND Address verified (`address?.verified`) |
| **Yellow** | `#C9A227` | Has GPS (`gps_lat && gps_lng`) AND has Address (city or state) but NOT both verified |
| **Red** | `#B85C4A` | All else (missing GPS or missing address data) |

## Braun Design Verification

Per the Braun/Ulm Design Language skill:

### Color Compliance
- Green: `#4A8C5E` - Braun "Verified/Success" functional color ✓
- Yellow: `#C9A227` - Braun "Medium/Warning" functional color ✓
- Red: `#B85C4A` - Braun "Low/Error" functional color ✓

### Anti-Pattern Check
- Color is used for **function** (communicating verification status), not decoration ✓
- Straight line geometry ✓
- No gradients, shadows, or decorative elements ✓

### Spacing (8pt Grid)
- Line height: 4px (half-step for fine adjustment, allowed per spec)
- Margin: 16px (mt-4) above the line to separate from Index Card

## Current Layout Structure

```
┌─────────────────────────────────────────────────────────────────┐
│ INDEX CARD HEADER                                               │
│ ┌──────────────┐  ┌────────────────────────────────────────────┐│
│ │ HERO IMAGE   │  │ Title, Status, Dates, Buildings           ││
│ └──────────────┘  └────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                                                     ← LINE HERE
                    ┌─────────────────────────────────────────────┐
  (negative space)  │ LocationMapSection                          │
                    └─────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ LocationInfo (full width)                                       │
└─────────────────────────────────────────────────────────────────┘
```

## Proposed New Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ INDEX CARD HEADER (unchanged)                                   │
└─────────────────────────────────────────────────────────────────┘

══════════════════════════════════════════════════════════════════
            ↑ Thin colored verification status line (4px height)

                    ┌─────────────────────────────────────────────┐
  (negative space)  │ LocationMapSection                          │
                    └─────────────────────────────────────────────┘
```

## Implementation

### File: `packages/desktop/src/pages/LocationDetail.svelte`

### Step 1: Add Derived State for Verification Status

After line ~82 (existing derived states), add:

```typescript
// Verification status for status line
const verificationStatus = $derived(() => {
  if (!location) return 'red';

  const hasGps = location.gps?.lat != null && location.gps?.lng != null;
  const hasAddress = !!(location.address?.city || location.address?.state);
  const gpsVerified = location.gps?.verifiedOnMap === true;
  const addressVerified = location.address?.verified === true;

  if (gpsVerified && addressVerified) {
    return 'green';
  } else if (hasGps && hasAddress) {
    return 'yellow';
  } else {
    return 'red';
  }
});
```

### Step 2: Add Status Line After Index Card

After line 1021 (closing `</div>` of Index Card Header section), before the `{#if isEditing}` block, add:

```svelte
<!-- Verification Status Line -->
<div
  class="h-1 w-full rounded-sm"
  class:bg-[#4A8C5E]={verificationStatus === 'green'}
  class:bg-[#C9A227]={verificationStatus === 'yellow'}
  class:bg-[#B85C4A]={verificationStatus === 'red'}
  title={verificationStatus === 'green' ? 'GPS and Address verified' :
         verificationStatus === 'yellow' ? 'Has GPS and Address (not fully verified)' :
         'Missing GPS or Address data'}
></div>
```

### Step 3: Handle Sub-Location Context

When viewing a sub-location, check the sub-location's GPS verification status:

```typescript
const verificationStatus = $derived(() => {
  if (!location) return 'red';

  // For sub-locations, check sub-location GPS + host address
  if (isViewingSubLocation && currentSubLocation) {
    const hasGps = currentSubLocation.gps_lat != null && currentSubLocation.gps_lng != null;
    const hasAddress = !!(location.address?.city || location.address?.state);
    const gpsVerified = currentSubLocation.gps_verified_on_map === true;
    const addressVerified = location.address?.verified === true;

    if (gpsVerified && addressVerified) return 'green';
    if (hasGps && hasAddress) return 'yellow';
    return 'red';
  }

  // For host/regular locations
  const hasGps = location.gps?.lat != null && location.gps?.lng != null;
  const hasAddress = !!(location.address?.city || location.address?.state);
  const gpsVerified = location.gps?.verifiedOnMap === true;
  const addressVerified = location.address?.verified === true;

  if (gpsVerified && addressVerified) return 'green';
  if (hasGps && hasAddress) return 'yellow';
  return 'red';
});
```

## Files to Modify

| File | Changes |
|------|---------|
| `packages/desktop/src/pages/LocationDetail.svelte` | Add derived state (~line 82), add status line element (~line 1022) |

## Scope Boundaries

- Only add the status line and its logic
- DO NOT modify Index Card Header content
- DO NOT modify LocationMapSection or LocationInfo
- DO NOT add any other visual elements

## Verification Checklist

After implementation:
1. Location with verified GPS + verified Address → Green line
2. Location with GPS + Address (not verified) → Yellow line
3. Location missing GPS or Address → Red line
4. Sub-location with verified GPS + host verified Address → Green line
5. Line is thin (4px), full width, positioned between Index Card and LocationMapSection
6. Tooltip explains the status on hover
