# Import Modal Type & Sub-Type Auto-Fill Implementation Guide

## Overview

This guide documents the Type and Sub-Type auto-fill system for the Import Modal. The system provides database-wide type suggestions and automatically fills the Type field when a user enters a known Sub-Type.

## What Changed

### Before
- Type field was filtered by selected state (only showed types used in that state)
- Sub-Type was filtered by selected Type (only showed sub-types for that type)
- Helper text showed "Types in {state}"
- No auto-fill between fields

### After
- Type field shows ALL types from database (database-wide)
- Sub-Type field shows ALL sub-types from database (database-wide)
- No helper text
- Auto-fill: entering "church" in Sub-Type → Type auto-fills with "Faith"

## Files Modified

### 1. `src/components/ImportModal.svelte`

**Changes:**
1. Added import for type hierarchy
2. Removed state-based type filtering
3. Made sub-type suggestions database-wide
4. Added auto-fill $effect
5. Removed state helper text
6. Updated Type field to use `allTypes` instead of `availableTypes`

### 2. `src/lib/type-hierarchy.ts` (created earlier)

Contains the Type → Sub-Type mapping used for auto-fill.

## How It Works

### Type Hierarchy Map

Located in `src/lib/type-hierarchy.ts`:

```typescript
export const TYPE_HIERARCHY: Record<string, string[]> = {
  'Faith': ['Church', 'Chapel', 'Monastery', 'Temple', ...],
  'Medical': ['Hospital', 'Sanatorium', 'Asylum', ...],
  'Industrial': ['Factory', 'Mill', 'Foundry', ...],
  // ... more categories
};
```

### Auto-Fill Logic

In `ImportModal.svelte`:

```typescript
import { getTypeForSubtype } from '../lib/type-hierarchy';

// Auto-fill type when user enters a known sub-type
$effect(() => {
  if (subType && !type) {
    const matchedType = getTypeForSubtype(subType);
    if (matchedType) {
      type = matchedType;
    }
  }
});
```

**How it works:**
1. User types in Sub-Type field (e.g., "Church")
2. The `$effect` runs whenever `subType` changes
3. If `subType` has a value AND `type` is empty:
   - Look up the sub-type in the hierarchy
   - If found, set `type` to the parent type (e.g., "Faith")
4. User can still override the auto-filled type

### Database-Wide Suggestions

**Type Suggestions:**
```typescript
function getTypeSuggestions(): string[] {
  const types = new Set<string>();
  allLocations.forEach(loc => {
    if (loc.type) types.add(loc.type);
  });
  return Array.from(types).sort();
}
```

**Sub-Type Suggestions:**
```typescript
function getSubTypeSuggestions(): string[] {
  const subTypes = new Set<string>();
  allLocations.forEach(loc => {
    if (loc.stype) subTypes.add(loc.stype);
  });
  return Array.from(subTypes).sort();
}
```

Both functions iterate through ALL locations in the database, not filtered by state or type.

## User Experience

### Scenario 1: User Knows the Sub-Type
1. User clicks on Sub-Type field
2. Types "church"
3. Autocomplete shows "Church" from database
4. User selects it
5. Type field auto-fills with "Faith"
6. User can change Type if needed

### Scenario 2: User Knows the Type
1. User clicks on Type field
2. Types "med"
3. Autocomplete shows "Medical" from database
4. User selects it
5. Sub-Type field remains empty (no auto-fill in this direction)
6. User manually enters Sub-Type

### Scenario 3: User Enters Unknown Sub-Type
1. User types "Custom Building" in Sub-Type
2. No match in hierarchy
3. Type field remains empty
4. User must manually enter Type

## Testing Checklist

- [ ] Type field shows ALL types from database (not filtered by state)
- [ ] Sub-Type field shows ALL sub-types from database
- [ ] Typing "church" in Sub-Type → Type auto-fills with "Faith"
- [ ] Typing "hospital" in Sub-Type → Type auto-fills with "Medical"
- [ ] User can override auto-filled Type
- [ ] Unknown sub-types don't cause errors
- [ ] Form submission works correctly
- [ ] No "Types in {state}" helper text appears

## Adding New Type/Sub-Type Mappings

To add new mappings, edit `src/lib/type-hierarchy.ts`:

```typescript
export const TYPE_HIERARCHY: Record<string, string[]> = {
  // Add new category
  'NewCategory': ['SubType1', 'SubType2', 'SubType3'],

  // Or add to existing category
  'Faith': ['Church', 'Chapel', ..., 'NewSubType'],
};
```

The reverse lookup is built automatically when the module loads.

## Troubleshooting

### Auto-fill not working
1. Check that `type-hierarchy.ts` is imported correctly
2. Verify the sub-type is in the hierarchy (case-insensitive)
3. Check browser console for errors

### Suggestions not appearing
1. Verify `allLocations` is populated (check `loadOptions()`)
2. Check that locations have `type` and `stype` fields populated
3. Verify AutocompleteInput component is working

### Type field still shows state-filtered results
1. Ensure `filterTypesByState` function was removed
2. Ensure Type field uses `allTypes` not `availableTypes`
3. Clear browser cache / hard refresh

## Related Files

- `src/components/ImportModal.svelte` - Main form component
- `src/components/AutocompleteInput.svelte` - Autocomplete dropdown
- `src/lib/type-hierarchy.ts` - Type/Sub-Type mappings
- `src/components/ImportForm.svelte` - Similar logic (older form)
- `src/components/LocationEditForm.svelte` - Edit form with same auto-fill
