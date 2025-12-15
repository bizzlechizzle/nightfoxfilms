# DECISION-007: State Field Autocomplete Refactor

**Date**: 2025-11-24
**Status**: Accepted
**Related Issue**: docs/resolved-issues/2025-11-24_state-field-autocomplete.md

## Context

The application has three location creation/editing forms:
1. **ImportModal.svelte** - Global quick-create modal (Dashboard, Navigation, Atlas)
2. **ImportForm.svelte** - Comprehensive form on /imports page
3. **LocationEditForm.svelte** - Edit modal on location detail pages

Each form implemented the state field independently:
- ImportModal used a `<select>` dropdown populated only with existing states from database
- ImportForm used a plain `<input>` with `maxlength="2"`
- LocationEditForm used a plain `<input>` with `maxlength="2"`

This created two problems:
1. **UX inconsistency**: Users couldn't type in ImportModal, but could in other forms
2. **Maintenance burden**: Fixing one form doesn't fix others

## Decision

### 1. Standardize on AutocompleteInput for State Fields

All state fields now use `<AutocompleteInput>` component with:
- All 50 US states + territories pre-loaded as suggestions
- Format: "NY (New York)" for easy recognition
- Input normalization: accepts "NY", "ny", "New York", "new york" → stores "NY"

### 2. Create Shared Constants

Extracted repeated enums to `src/constants/location-enums.ts`:
- `DOCUMENTATION_OPTIONS`
- `ACCESS_OPTIONS`
- `GPS_SOURCE_OPTIONS`

### 3. Create Reusable Form Component (Future Use)

Created `src/components/LocationFormFields.svelte` as a configurable form field component. Not yet integrated into all forms, but available for future consolidation.

## Consequences

### Positive
- **Consistent UX**: All forms now allow typing state names
- **Better discovery**: Users see all 50 states, not just existing ones
- **Reduced duplication**: Shared constants prevent drift
- **Foundation for consolidation**: LocationFormFields ready for future refactoring

### Negative
- **Three implementations remain**: Full form consolidation deferred
- **Slight complexity**: State normalization logic duplicated across forms

### Neutral
- No database changes required
- No migration needed
- Pattern matches existing city/county/type autocomplete

## Files Changed

| File | Change |
|------|--------|
| `src/components/ImportModal.svelte` | State, Type, Author → AutocompleteInput |
| `src/components/ImportForm.svelte` | State → AutocompleteInput |
| `src/components/LocationEditForm.svelte` | State → AutocompleteInput |
| `src/constants/location-enums.ts` | NEW: Shared enum constants |
| `src/components/LocationFormFields.svelte` | NEW: Reusable form component |

## Future Work

- Consider full form consolidation using LocationFormFields.svelte
- Apply same pattern to filter dropdowns (Atlas, Locations, Search pages)
