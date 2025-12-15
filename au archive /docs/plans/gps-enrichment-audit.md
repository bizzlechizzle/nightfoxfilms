# GPS Enrichment Audit Plan

## Problem Statement

The GPS enrichment feature is broken. User reported:
- "CHECK constraint failed: length(address_state) = 2"
- Feature "just broken now"

## Recent Commits Under Review

| Commit | Description | Risk |
|--------|-------------|------|
| `1c3e29b` | fix: normalize state to 2-letter code | Added AddressNormalizer calls |
| `9c445c7` | feat: add full normalization to GPS enrichment | Added reverse geocode + regions |
| `dffea9d` | fix: apply GPS enrichment when user approves | Fixed true→pointIndex bug |
| `2a92160` | feat: add GPS enrichment (Migration 42) | Original feature |

## Audit Findings

### Issue 1: Complexity Creep

The original simple GPS update:
```typescript
// BEFORE (simple, worked)
await db.updateTable('locs').set({
  gps_lat: point.lat,
  gps_lng: point.lng,
  gps_source: 'ref_map_import',
  gps_verified_on_map: 0,
  gps_accuracy: null,
  gps_captured_at: new Date().toISOString(),
}).where('locid', '=', enrichment.existingLocId).execute();
```

Was expanded to include reverse geocoding and region calculation:
```typescript
// AFTER (complex, broken)
// 1. Reverse geocode (async, can fail)
// 2. Normalize address fields
// 3. Calculate region fields
// 4. Spread conditionally into update object
// 5. Update with many optional fields
```

### Issue 2: State Constraint Error

The database has a CHECK constraint: `length(address_state) = 2`

Possible failure points:
1. `AddressNormalizer.normalizeStateCode()` returns `null` for unknown states
2. The spread operator `...(addressData.state && { address_state: addressData.state })` might include an invalid state
3. If `normalizeStateCode()` returns a full state name instead of code

### Issue 3: Mixed Concerns

GPS enrichment should ONLY add GPS. The user explicitly asked for normalization AFTER seeing GPS was working. But the implementation was done in a single commit without testing the GPS-only version first.

## Root Cause Analysis

Looking at the code flow:

1. `reverseGeocode()` is called - can throw or return null
2. If it fails, `addressData` stays empty `{}`
3. `stateForRegion` falls back to `point.state` which may be a full name like "New York"
4. `normalizeStateCode("New York")` should return "NY" - need to verify this works
5. The spread operator conditionals may not handle null correctly

**Most likely issue**: The state normalization is working, but something in the spread operator logic is adding a bad value. OR the geocoding service is returning a state that can't be normalized.

## Proposed Fix Options

### Option A: Rollback to Simple GPS-Only (Recommended)

Revert to the working GPS-only version, then incrementally add features:
1. Rollback to commit `dffea9d` enrichment logic (GPS only)
2. Test GPS enrichment works
3. Add reverse geocoding in a separate, tested commit
4. Add region calculation in a separate, tested commit

### Option B: Fix Forward with Defensive Coding

Keep current structure but add:
1. Explicit null checks before spreading
2. Validation that state is exactly 2 chars before including
3. Try/catch around the entire enrichment block
4. Better error logging

### Option C: Two-Phase Approach

1. Apply GPS only first (guaranteed to work)
2. Queue a background job to normalize address/regions afterward
3. If normalization fails, GPS is still saved

## Recommended Action

**Option A: Rollback to Simple GPS-Only**

The feature was working before the "full normalization" commit. Rollback that specific change, test, then add features incrementally.

## Implementation Steps

1. [ ] Identify the exact failing line (need error logs)
2. [ ] Rollback enrichment code to GPS-only version
3. [ ] Test GPS enrichment works
4. [ ] Re-add normalization with proper validation
5. [ ] Test each field type individually
6. [ ] Commit with full test coverage

## Files to Modify

- `packages/desktop/electron/main/ipc-handlers/ref-maps.ts` (lines 527-612)

## Testing Checklist

Before any commit:
1. [ ] Import ref map with match that has NO GPS
2. [ ] Approve the enrichment
3. [ ] Verify GPS is applied
4. [ ] Verify no constraint errors
5. [ ] Verify regions are populated (if feature re-added)
