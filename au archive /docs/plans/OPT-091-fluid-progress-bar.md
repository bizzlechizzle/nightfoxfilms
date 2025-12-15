# OPT-091: Progress Bar Activity Indicator

**Status:** Implemented
**Date:** 2025-12-07

## Problem

Import progress bar appeared frozen when backend updates were slow, making users think the system was broken.

## Solution

Braun-compliant text overlay inside the progress bar showing:
- Current step (derived from percent: Scanning/Hashing/Copying/Validating/Finalizing)
- Current filename being processed
- Percentage

```
[██████████████░░░░ Hashing · IMG_4521.CR2 · 35% ░░░░░░░]
```

Text uses `mix-blend-difference` for automatic contrast inversion over filled/unfilled areas.

## Files Changed

| File | Change |
|------|--------|
| `packages/desktop/src/components/location/LocationImportZone.svelte` | Progress bar with centered status text overlay |
| `packages/desktop/src/pages/LocationDetail.svelte` | Pass `currentFile` to import store |
| `packages/desktop/src/stores/import-store.ts` | Expose `currentFilename` in derived store |
| `packages/desktop/src/components/ImportForm.svelte` | Updated (unused progress bar, kept in sync) |
| `packages/desktop/src/app.css` | Removed unused animation keyframes |

## Braun Compliance

- No decorative animation
- Functional text (step + filename + percent)
- Text changing = proof of system activity
- Pure geometry, approved colors
- Honest feedback about actual work
