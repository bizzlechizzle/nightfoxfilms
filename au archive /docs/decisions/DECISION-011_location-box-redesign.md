# DECISION-011: Location Box UI Redesign

**Status**: In Progress
**Date**: 2025-11-24
**Impact**: High - Complete redesign of Location Box on detail page

---

## Context

Following DECISION-010 (verification tracking system), the Location Box UI needs a complete redesign to better display verification status, provide a cleaner edit workflow, and support cultural regions.

## Decision

Redesign the Location Box with:

1. **Verification Checkmarks**: Simple ✓/✗ indicators (green/red) for each section
2. **Three-way Verification**: Location ✓ requires Mailing Address + GPS + Area all verified
3. **Edit Modal**: Popup with map for GPS marker dragging (not inline editing)
4. **Mini Map Improvements**: Golden ratio, satellite+labels default, limited interaction
5. **Expand → Atlas**: Remove lightbox, navigate to full Atlas page instead
6. **Cultural Region**: Predefined dropdown by state + "Other" option

## Layout

```
┌─────────────────────────────────────────────────┐
│ Location ✓/✗                            {edit}  │
├─────────────────────────────────────────────────┤
│ Mailing Address ✓/✗                     {copy}  │
│ 123 Main Street, Rochester, NY 14625            │
├─────────────────────────────────────────────────┤
│ GPS ✓/✗                                 {copy}  │
│ 43.153242, -77.513231                           │
│ ┌─────────────────────────────────────────────┐ │
│ │   Mini Map (1.618:1 golden ratio)           │ │
│ │   Satellite + labels | Limited interaction  │ │
│ │                      [↗ Expand to Atlas]    │ │
│ └─────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────┤
│ Area ✓/✗                                        │
│ County: Monroe      Region: Northeast           │
│ Cultural Region: Finger Lakes                   │
└─────────────────────────────────────────────────┘
```

## Verification Logic

| Section | Verified When | Counts Toward Location |
|---------|---------------|------------------------|
| Mailing Address | User clicks verify in edit modal | YES |
| GPS | User verifies via map marker in edit modal | YES |
| Area | Auto-verified when GPS is verified | YES |
| Cultural Region | User-entered (subjective) | NO |

**Location ✓** = All three (Address + GPS + Area) verified

## Key Changes

### Removed
- MapLightbox.svelte (expand now goes to Atlas page)
- "GPS Verified" text indicator
- "View & Verify" button
- Inline "Atlas" button

### Added
- LocationEditModal.svelte (new popup with map)
- cultural-regions.ts (predefined regions by state)
- ✓/✗ checkmarks on each section header
- "Copied!" notification animation
- Golden ratio mini map (1.618:1)

### Modified
- LocationMapSection.svelte (complete rewrite)
- Map.svelte (limitedInteraction mode, satellite+labels default, compact controls)
- Atlas.svelte (handle URL params for centering)
- database.ts (Migration 15: cultural_region column)

## Database Changes

Migration 15 adds:
```sql
ALTER TABLE locs ADD COLUMN cultural_region TEXT;
```

## Rationale

- **Checkmarks vs badges**: Simple ✓/✗ is cleaner, more scannable
- **Edit modal vs inline**: Complex editing (GPS drag) better suited to modal
- **Atlas vs lightbox**: Full Atlas provides more exploration capability
- **Cultural Region subjective**: Not counted in verification since it's opinion-based
- **Golden ratio**: Visually pleasing aspect ratio for mini map

## Consequences

- MapLightbox.svelte deleted (breaking change if used elsewhere - verify first)
- Edit workflow changes from inline to popup
- Users must open edit modal to verify (can't verify inline)

## References

- DECISION-010: Verification tracking system (prerequisite)
- issuetracking.md: Full implementation plan
- claude.md: Development rules compliance

---

## Implementation Checklist

- [ ] Migration 15: cultural_region
- [ ] cultural-regions.ts
- [ ] Map.svelte updates
- [ ] LocationEditModal.svelte (new)
- [ ] LocationMapSection.svelte (rewrite)
- [ ] Delete MapLightbox.svelte
- [ ] Atlas.svelte URL params
- [ ] Build & test
