# DECISION-017: Premium Spacing Standardization

**Date:** 2025-11-25
**Status:** Implemented
**Scope:** UI spacing across all card components

## Context

Card components throughout the app had inconsistent and excessive spacing due to compounding vertical padding. Each section used `py-6` (24px top + 24px bottom), creating 48px gaps between adjacent sections where the bottom padding of one section combined with the top padding of the next.

Example: Between "Location" header and "GPS" section:
- 24px bottom padding from header
- 24px top padding from GPS section
- = 48px total gap (excessive)

## Decision

Implement a unified container padding approach with a standardized premium spacing scale:

### Premium Spacing Scale

| Element | Class | Pixels | Rationale |
|---------|-------|--------|-----------|
| Card top padding | `pt-6` | 24px | Breathing room from card edge |
| Card bottom padding | `pb-6` | 24px | Balanced card feel |
| Header to content gap | `pt-4` / `pb-4` | 16px | Tight connection |
| Section title to content | `mb-2` | 8px | Tight label relationship |
| Between sections | `mt-5` | 20px | Clear separation without excess |
| Definition list items | `space-y-3` | 12px | Tight, scannable list |
| Grid row gaps | `gap-y-3` | 12px | Consistent with lists |
| Card heading margin | `mb-3` | 12px | Consistent header spacing |

### Pattern Change

**Before (compounding):**
```svelte
<div class="px-8 py-6">Header</div>
<div class="px-8 py-6">Section 1</div>
<div class="px-8 py-6">Section 2</div>
```

**After (unified):**
```svelte
<div class="px-8 pt-6 pb-4">Header</div>
<div class="px-8">Section 1</div>
<div class="px-8 mt-5">Section 2</div>
<div class="px-8 mt-5 pb-6">Section 3 (last)</div>
```

## Files Modified

### Location Detail Components
- `LocationMapSection.svelte` - Unified padding, `mt-5` between sections, `mb-2` titles
- `LocationInfo.svelte` - Unified padding, `space-y-3`
- `LocationNerdStats.svelte` - `gap-y-3`, `mb-3` headings
- `LocationImportZone.svelte` - Standardized margins
- `LocationBookmarks.svelte` - `mb-3` headings
- `NotesSection.svelte` - `space-y-3`, `mb-3` headings

### Page-Level Components
- `Dashboard.svelte` - All card headings `mb-3`
- `Settings.svelte` - Section headings `mb-3`, `space-y-3`

### Shared Components
- `DatabaseSettings.svelte` - `mb-3`, `space-y-3`
- `HealthMonitoring.svelte` - `mb-3`, `mb-5` sections
- `RecentImports.svelte` - `mb-3` heading

## Visual Result

| Gap Type | Before | After |
|----------|--------|-------|
| Header to content | 48px | 16px |
| Between sections | 48px | 20px |
| Heading to list | 16px | 12px |
| List item spacing | 16px | 12px |

## Consequences

- Tighter, more intentional spacing throughout
- Consistent rhythm across all cards
- Premium, professional appearance
- Horizontal padding (`px-8` = 32px) preserved for premium feel
