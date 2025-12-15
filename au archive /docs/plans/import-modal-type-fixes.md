# Import Modal: Type & Sub-Type Comprehensive Fix

## Status: IMPLEMENTED

## Task Requirements

1. **Type Field**
   - Should NOT be restricted per state - database wide ❌ (currently filtered by state)
   - Autofill as user types matching existing database ✅ (works via AutocompleteInput)
   - If user types a sub-type (e.g., "church") in Type field → auto-fill Type="Faith", Sub-Type="Church"

2. **Sub-Type Field**
   - Should autofill from database-wide entries ❌ (currently filtered by selected Type)
   - Match existing sub-types as user types

## Current State Analysis

### File: `src/components/ImportModal.svelte`

| Issue | Current Behavior | Line Numbers |
|-------|------------------|--------------|
| Type filtered by state | `filterTypesByState()` restricts suggestions | 160-184 |
| State helper text | Shows "Types in {state}" | 561-563 |
| Sub-Type filtered by Type | `getSubTypeSuggestions()` only shows matching type | 116-126 |
| No sub-type detection | Typing "church" in Type doesn't trigger any logic | N/A |

### Current Code Issues

**1. State-based Type Filtering (lines 160-184):**
```typescript
async function filterTypesByState(state: string) {
  // Filters types to only those used in the selected state
  // User wants ALL types, not state-filtered
}
```

**2. Type-based Sub-Type Filtering (lines 116-126):**
```typescript
function getSubTypeSuggestions(): string[] {
  // Only shows sub-types matching selected type
  // User wants ALL sub-types
}
```

**3. Helper text (lines 561-563):**
```svelte
{#if selectedState && availableTypes.length > 0}
  <p class="text-xs text-gray-500 mt-1">Types in {selectedState}</p>
{/if}
```

## Proposed Changes

### 1. Remove State-Based Type Filtering

**Delete/modify `filterTypesByState` function:**
- Remove the function entirely
- Always use `allTypes` (database-wide) for suggestions
- Remove the $effect that calls `filterTypesByState`

### 2. Remove State Helper Text

**Delete lines 561-563:**
```svelte
{#if selectedState && availableTypes.length > 0}
  <p class="text-xs text-gray-500 mt-1">Types in {selectedState}</p>
{/if}
```

### 3. Make Sub-Type Suggestions Database-Wide

**Update `getSubTypeSuggestions()` (lines 116-126):**
```typescript
function getSubTypeSuggestions(): string[] {
  const subTypes = new Set<string>();
  allLocations.forEach(loc => {
    if (loc.stype) subTypes.add(loc.stype);
  });
  return Array.from(subTypes).sort();
}
```

### 4. Add Type-to-SubType Auto-Fill Logic

**Import the type hierarchy:**
```typescript
import { getTypeForSubtype } from '../lib/type-hierarchy';
```

**Add $effect to detect sub-type in Type field:**
```typescript
// Auto-detect: if user types a sub-type in Type field, move it appropriately
$effect(() => {
  if (type && !subType) {
    const matchedParentType = getTypeForSubtype(type);
    if (matchedParentType) {
      // User typed a sub-type in the Type field
      subType = type;  // Move to sub-type
      type = matchedParentType;  // Set parent type
    }
  }
});
```

### 5. Add Sub-Type to Type Auto-Fill (existing logic)

**Add $effect for sub-type changes:**
```typescript
// Auto-fill: if user types a sub-type, fill in the parent type
$effect(() => {
  if (subType && !type) {
    const matchedType = getTypeForSubtype(subType);
    if (matchedType) {
      type = matchedType;
    }
  }
});
```

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/ImportModal.svelte` | Remove state filtering, update sub-type suggestions, add auto-fill logic |
| `src/lib/type-hierarchy.ts` | Already created - no changes needed |

## Detailed Code Changes

### ImportModal.svelte Changes

1. **Add import** (after line 6):
   ```typescript
   import { getTypeForSubtype } from '../lib/type-hierarchy';
   ```

2. **Simplify type suggestions** - replace `availableTypes` usage with `allTypes`

3. **Remove `filterTypesByState` function** (lines 160-184)

4. **Remove state filter $effect** (lines 187-193)

5. **Update `getSubTypeSuggestions`** to be database-wide (lines 116-126)

6. **Add auto-fill $effects** after state declarations

7. **Remove state helper text** (lines 561-563)

8. **Update Type field to use `allTypes`** instead of `availableTypes`

## CLAUDE.md Compliance Audit

| Rule | Status | Notes |
|------|--------|-------|
| Scope Discipline | ✅ | Only fixing Type/Sub-Type as requested |
| Keep It Simple | ✅ | Removing complexity (state filtering), adding simple auto-fill |
| Archive-First | ✅ | Consistent classification across database |
| Offline-First | ✅ | Type hierarchy is hardcoded, works offline |

## Testing Checklist

- [ ] Type field shows ALL types from database (not filtered by state)
- [ ] "Types in {state}" helper text is removed
- [ ] Sub-Type field shows ALL sub-types from database
- [ ] Typing "church" in Type field → Type="Faith", Sub-Type="Church"
- [ ] Typing "hospital" in Sub-Type field → Type="Medical" auto-fills
- [ ] User can still manually enter any type/sub-type
- [ ] Form submission works correctly
- [ ] Autocomplete suggestions appear as user types

## Implementation Order

1. Add import for type-hierarchy
2. Remove state-based filtering function
3. Remove state filter $effect
4. Update getSubTypeSuggestions to be database-wide
5. Add auto-fill $effects
6. Update Type field to use allTypes
7. Remove state helper text
8. Test all scenarios
