# ADR-071: Hero Display Removal

**Status:** Accepted
**Date:** 2025-12-06
**Deciders:** Bryant

## Context

The LocationHero component provided a cinematic hero image display at the top of Dashboard and LocationDetail pages, featuring:
- Full-width hero image with gradient overlay
- Auto-sizing display name with title fitting logic
- Focal point editor for image cropping
- Custom short name fields (`locnamShort`, `locnamUseThe`)

This functionality was deemed unnecessary overhead that didn't serve the core research mission.

## Decision

Remove all hero **display** functionality while preserving hero **thumbnail** logic for card displays.

### Removed
- `LocationHero.svelte` component
- Hero sections from Dashboard and LocationDetail pages
- Focal point fields (`hero_focal_x`, `hero_focal_y`)
- Display name fields (`locnamShort`, `locnamUseThe`)
- `generateHeroName()` and `getHeroDisplayName()` methods
- `fitTitle()` auto-sizing logic
- Dashboard hero settings (`dashboard_hero_imghash`, focal points)
- Focal point editor modal in MediaViewer

### Preserved
- `hero_imghash` column (used for card thumbnails)
- Auto-hero selection on import (first image becomes thumbnail)
- "Set as Thumbnail" button in MediaViewer (simplified from focal point editor)
- `heroThumbPath` in location queries

## Consequences

### Positive
- Simpler UI focused on research workflow
- Reduced code complexity (~400 lines removed)
- Faster page loads (no hero image rendering)
- Cleaner domain model

### Negative
- Database columns still exist (migrations preserved per project rules)
- Less visual impact on location pages

## Files Changed

**Deleted:**
- `packages/desktop/src/components/location/LocationHero.svelte`

**Modified:**
- `packages/desktop/src/components/location/index.ts`
- `packages/core/src/domain/location.ts`
- `packages/core/src/domain/location.test.ts`
- `packages/desktop/electron/main/database.types.ts`
- `packages/desktop/electron/main/ipc-validation.ts`
- `packages/desktop/electron/repositories/sqlite-location-repository.ts`
- `packages/desktop/electron/__tests__/integration/helpers/test-database.ts`
- `packages/desktop/src/components/location/LocationInfo.svelte`
- `packages/desktop/src/components/MediaViewer.svelte`
- `packages/desktop/src/pages/Dashboard.svelte`
- `packages/desktop/src/pages/LocationDetail.svelte`

## Notes

Database migrations adding the removed columns are preserved (per CLAUDE.md rules). The columns will be created but unused. Wiping the test database before next boot as planned.
