# ADR: Braun/Rams Design System Implementation

**Status:** Implemented
**Date:** 2025-12-06
**Author:** Design System Overhaul

## Context

The AU Archive desktop application was migrated from a warm, editorial aesthetic to a Dieter Rams-inspired industrial design language. This ADR documents the design principles and implementation changes.

## Decision

Adopt a Braun/Rams design system characterized by:

### Core Principles (The Ten Principles Applied)

1. **Good design is innovative** - GPS confidence communicated through form, not decoration
2. **Good design makes a product useful** - Data density prioritized; every pixel serves research
3. **Good design is aesthetic** - Beauty emerges from precision, not embellishment
4. **Good design is unobtrusive** - UI recedes; content (photos, maps, metadata) dominates
5. **Good design is honest** - No faux depth (shadows), no simulated materials
6. **Good design is long-lasting** - Neutral palette ages gracefully across decades
7. **Good design is thorough** - Every detail considered; no random values
8. **Good design is environmentally friendly** - Minimal visual pollution; restful on eyes
9. **Good design is as little design as possible** - Remove until it breaks, then add one thing back

### What Was Removed

| Violation | Replacement |
|-----------|-------------|
| Gradient overlays on photography | Pure photography - no overlays |
| Shimmer/pulse animations (`animate-spin`, `animate-pulse`, `@keyframes`) | Static loading states (centered dot in bordered circle) |
| Decorative shadows (`shadow-md`, `shadow-lg`) | 1px borders only |
| Text shadows on titles | Clean typography hierarchy |
| Gold accent color (`#b9975c`) | Neutral braun-900 (`#1C1C1A`) |
| Decorative colors (amber, blue badges) | Functional status tokens only |

### GPS Functional Colors (Color = Information)

| Confidence | Hex | Usage |
|------------|-----|-------|
| Verified | `#4A8C5E` | Map-confirmed coordinates |
| High | `#5A7A94` | EXIF with <10m accuracy |
| Medium | `#C9A227` | Reverse-geocoded |
| Low | `#B85C4A` | Manual/estimate |
| None | `#8A8A86` | No coordinates |

### Static Loading Pattern

```svelte
<!-- Braun: Static loading indicator (no animation) -->
<div class="w-12 h-12 border-2 border-braun-300 rounded-full flex items-center justify-center">
  <div class="w-4 h-4 bg-braun-900 rounded-full"></div>
</div>
```

### Typography

- Maximum 4px border radius everywhere (no `rounded-lg`, `rounded-xl`)
- Exception: Progress bars and small status dots use `rounded-full` (functional, not decorative)
- Video play buttons use `rounded-full` (universally recognized symbol)

## Files Modified

54 files across the desktop package:
- All page components (Dashboard, Locations, LocationDetail, Atlas, Settings, etc.)
- All shared components (ImportModal, MediaViewer, SkeletonLoader, etc.)
- Location sub-components (LocationHero, LocationMapSection, etc.)
- Configuration files (tailwind.config.js, constants.ts, app.css)

## Consequences

### Positive
- Cleaner, more professional aesthetic
- Reduced visual noise
- Color now has semantic meaning (GPS confidence)
- Consistent design language across all 50+ components

### Neutral
- Some users may miss the warm aesthetic
- Progress bars and status dots retain `rounded-full` for functional recognition

### Verification

After implementation, verified:
- `linear-gradient|radial-gradient|bg-gradient` = 0 matches
- `animate-spin|animate-pulse|@keyframes|animation:` = 0 matches
- `shadow-md|shadow-lg|shadow-xl|text-shadow` = 0 matches (except comments)
- `#b9975c` (legacy gold) = 0 matches
- Build compiles successfully

## References

- Plan file: `docs/plans/braun-design-overhaul.md`
- Design tokens: `docs/design-system.md`
- Tailwind config: `packages/desktop/tailwind.config.js`
