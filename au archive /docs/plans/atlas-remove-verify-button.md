# Atlas View: Remove Verify Location Button

## Task Request
Remove the "Verify Location" button from the Atlas view. It is not needed in the Atlas view.

## Current State

### Files Involved
| File | Purpose |
|------|---------|
| `src/components/Map.svelte` | Shared map component with Verify Location button logic |
| `src/pages/Atlas.svelte` | Atlas page that uses Map component |

### How It Works Today
1. `Map.svelte` accepts optional prop: `onLocationVerify?: (locid, lat, lng) => void`
2. When `onLocationVerify` is provided, the button renders in marker popups
3. `Atlas.svelte` passes `onLocationVerify={handleLocationVerify}` at line 321
4. The button also enables draggable markers for verification

### Other Consumers of Map.svelte
- `LocationDetail.svelte` - May use verification for single-location context
- Need to verify Map.svelte remains functional for other pages

## Proposed Change

**Single-line change in `Atlas.svelte`:**

Remove the `onLocationVerify` prop from the Map component call (around line 321).

```diff
- onLocationVerify={handleLocationVerify}
```

**Also remove the unused handler function** (`handleLocationVerify`, lines 162-180) since it will no longer be called.

## Impact Analysis

| Aspect | Impact |
|--------|--------|
| Atlas View | No Verify button in popups, markers not draggable |
| LocationDetail | Unaffected (has its own handler if needed) |
| Map.svelte | No changes needed - already handles missing prop gracefully |
| Database | No changes |
| Other pages | No impact |

## CLAUDE.md Compliance Audit

| Rule | Status | Notes |
|------|--------|-------|
| Scope Discipline | ✅ | Only removing what's requested, no extras |
| Archive-First | ✅ | Verification still available in LocationDetail where context matters |
| Keep It Simple | ✅ | One prop removal + dead code cleanup |
| No AI in Docs | ✅ | N/A |
| GPS confidence ladder | ✅ | Verification path preserved in LocationDetail |

## Files to Modify

1. **`packages/desktop/src/pages/Atlas.svelte`**
   - Remove `onLocationVerify={handleLocationVerify}` prop (~line 321)
   - Remove `handleLocationVerify` function (lines 162-180)

## Testing Checklist

- [ ] Atlas view loads without errors
- [ ] Marker popups show location info but NO Verify button
- [ ] Markers are NOT draggable on Atlas
- [ ] LocationDetail still has verification capability (if implemented)

## Risk Assessment

**Low Risk** - This is a prop removal. The Map component already handles the case when `onLocationVerify` is not provided (button simply doesn't render).
