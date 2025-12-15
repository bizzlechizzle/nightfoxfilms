# Import Form: Type & Sub-Type Autofill Enhancement

## Task Request
1. Type should not be restricted per state - database wide ✅ (already works this way)
2. Type should autofill as user types matching existing database entries ✅ (already works)
3. If user types a matching sub-type, autofill BOTH type and sub-type correctly
   - Example: typing "church" → auto-fill type="Faith", sub-type="Church"
4. Sub-Type should autofill across database ✅ (already works)

## Current State

### Files Involved
| File | Purpose |
|------|---------|
| `src/components/ImportForm.svelte` | Import form with Type/Sub-Type fields |
| `src/components/AutocompleteInput.svelte` | Autocomplete component |
| `electron/main/ipc-handlers/locations.ts` | IPC for distinct types/subtypes |

### Current Behavior
- Type field: Shows autocomplete from all locations in database (works)
- Sub-Type field: Shows autocomplete from all locations in database (works)
- **NO hierarchy**: Typing "church" only matches sub-types, doesn't auto-fill type

## Missing Feature: Type Hierarchy

When user types a known sub-type, the system should recognize it and auto-populate the parent type.

### Option A: Hardcoded Type Hierarchy Map
Define a static map of type → subtypes:
```typescript
const TYPE_HIERARCHY = {
  'Faith': ['Church', 'Monastery', 'Temple', 'Synagogue', 'Mosque'],
  'Medical': ['Hospital', 'Sanatorium', 'Asylum', 'Psychiatric'],
  'Industrial': ['Factory', 'Mill', 'Foundry', 'Warehouse'],
  'Education': ['School', 'College', 'University'],
  'Residential': ['Hotel', 'Mansion', 'Resort', 'Apartment'],
  // ... etc
};
```

**Pros:** Fast, predictable, works offline
**Cons:** New subtypes require code changes

### Option B: Database-Derived Hierarchy
Query database for type/subtype pairs:
```sql
SELECT type, stype, COUNT(*) as count
FROM locs
WHERE type IS NOT NULL AND stype IS NOT NULL
GROUP BY type, stype
ORDER BY count DESC;
```

**Pros:** Learns from actual data, no hardcoding
**Cons:** Cold start problem (empty database), could have inconsistent mappings

### Recommended: Option A (Hardcoded)
- Provides consistent UX from day one
- Can be extended via settings/config later
- Matches CLAUDE.md "Keep It Simple" principle

## Proposed Changes

### 1. Create Type Hierarchy Map
**New file:** `src/lib/type-hierarchy.ts`

```typescript
export const TYPE_HIERARCHY: Record<string, string[]> = {
  'Faith': ['Church', 'Chapel', 'Monastery', 'Temple', 'Synagogue', 'Mosque', 'Cathedral'],
  'Medical': ['Hospital', 'Sanatorium', 'Asylum', 'Psychiatric', 'Clinic', 'Infirmary'],
  'Industrial': ['Factory', 'Mill', 'Foundry', 'Warehouse', 'Power Plant', 'Refinery'],
  'Education': ['School', 'College', 'University', 'Academy', 'Seminary'],
  'Residential': ['Hotel', 'Mansion', 'Resort', 'Apartment', 'Dormitory', 'Orphanage'],
  'Government': ['Courthouse', 'Prison', 'Jail', 'Post Office', 'Armory'],
  'Commercial': ['Theater', 'Bank', 'Department Store', 'Office Building'],
  'Transportation': ['Train Station', 'Airport', 'Bus Station'],
  'Military': ['Base', 'Fort', 'Bunker', 'Barracks'],
  'Recreation': ['Amusement Park', 'Stadium', 'Pool', 'Country Club'],
};

// Reverse lookup: subtype → type
export const SUBTYPE_TO_TYPE: Record<string, string> = {};
for (const [type, subtypes] of Object.entries(TYPE_HIERARCHY)) {
  for (const subtype of subtypes) {
    SUBTYPE_TO_TYPE[subtype.toLowerCase()] = type;
  }
}

export function getTypeForSubtype(subtype: string): string | null {
  return SUBTYPE_TO_TYPE[subtype.toLowerCase()] || null;
}
```

### 2. Update ImportForm.svelte
Add logic to auto-fill type when user enters a known subtype:

```typescript
// Watch subtype changes and auto-fill type if matched
$effect(() => {
  if (newSubType && !newType) {
    const matchedType = getTypeForSubtype(newSubType);
    if (matchedType) {
      newType = matchedType;
    }
  }
});
```

### 3. Update AutocompleteInput (Optional Enhancement)
Show hierarchy hints in suggestions:
- When typing "chu", show: "Church (Faith)"

## CLAUDE.md Compliance Audit

| Rule | Status | Notes |
|------|--------|-------|
| Scope Discipline | ✅ | Only adds requested autofill feature |
| Keep It Simple | ✅ | Simple map lookup, no complex logic |
| Archive-First | ✅ | Helps consistent location classification |
| Offline-First | ✅ | Hardcoded map works offline |

## Files to Modify

1. **NEW: `packages/desktop/src/lib/type-hierarchy.ts`**
   - Type → Subtype hierarchy map
   - Reverse lookup function

2. **`packages/desktop/src/components/ImportForm.svelte`**
   - Import hierarchy functions
   - Add $effect to auto-fill type when subtype matches

## Testing Checklist

- [ ] Type field still autocompletes from existing database entries
- [ ] Sub-Type field still autocompletes from existing database entries
- [ ] Typing "church" in Sub-Type auto-fills Type with "Faith"
- [ ] Typing "hospital" in Sub-Type auto-fills Type with "Medical"
- [ ] User can override auto-filled type manually
- [ ] Unknown subtypes don't cause errors
- [ ] Form submission works correctly

## Decisions

1. **Type hints in suggestions?** No - keep it simple, auto-fill speaks for itself
2. **Apply to LocationEditForm?** Yes
3. **Allow override?** Yes - user can always change the auto-filled type

## Files to Modify (Updated)

1. **NEW: `packages/desktop/src/lib/type-hierarchy.ts`**
   - Type → Subtype hierarchy map
   - Reverse lookup function

2. **`packages/desktop/src/components/ImportForm.svelte`**
   - Import hierarchy functions
   - Add $effect to auto-fill type when subtype matches

3. **`packages/desktop/src/components/location/LocationEditForm.svelte`**
   - Same auto-fill logic as ImportForm
