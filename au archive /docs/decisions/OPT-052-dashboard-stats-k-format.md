# OPT-052: Dashboard Stats "k" Formatting

## Status
Accepted

## Date
2025-12-02

## Context
The Dashboard stats row displays raw numbers for locations, images, videos, documents, and bookmarks. Large numbers like "3024" take up space and are harder to scan quickly.

## Decision
Format large numbers (≥1000) with a "k" suffix for better readability:
- Numbers < 1000: Display as-is (e.g., 31, 345, 93)
- Numbers ≥ 1000: Show with "k" suffix (e.g., 3024 → "3k", 3150 → "3.2k")

## Implementation
Added `formatCount(n: number): string` helper function in Dashboard.svelte that:
1. Returns raw number for values < 1000
2. Divides by 1000 and rounds to 1 decimal place for values ≥ 1000
3. Drops trailing ".0" for whole numbers (3.0k → 3k)

## Changes
- `packages/desktop/src/pages/Dashboard.svelte`: Added formatCount helper, applied to all 5 stat displays

## Consequences
- Cleaner, more scannable stats display
- Consistent formatting across all stat types
- No data changes, display only
