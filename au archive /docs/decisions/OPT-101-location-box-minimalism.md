# OPT-101: Location Box Minimalism

**Status:** Implemented
**Date:** 2025-12-08
**Component:** `LocationMapSection.svelte`

---

## Summary

Remove redundant section labels from the Location Box and apply visual tweaks per Braun Design Verification audit. The geographic data is self-evident—labels add words without adding understanding.

---

## Changes

### 1. Remove Redundant Section Labels

| Current | New |
|---------|-----|
| `GPS` | *(removed)* |
| `ADDRESS` | *(removed)* |
| `LOCAL` | *(removed)* |
| `REGION` | *(removed)* |

**Rationale:**
- Coordinates are obviously GPS
- Street/city/state is obviously an address
- County → State → Country hierarchy is self-explanatory
- Per Braun Principle #10: "Less, but better"

### 2. Hide Empty Sections (PUEA)

Instead of showing "No coordinates available" or "No local information available" in italic, hide sections entirely when they have no data.

**Before:**
```
GPS
No coordinates available

ADDRESS
No address set

LOCAL
No local information available
```

**After:** *(sections simply don't render)*

### 3. Fix "Copied!" Positioning

Changed from `absolute -right-2` to `absolute right-0` to stay within container bounds.

### 4. Increase Section Spacing

Changed from `mt-4` to `mt-6` for better visual breathing room (24px).

### 5. Typography Hierarchy Fix (Post-Audit)

After initial implementation, a follow-up Braun verification identified that removing labels caused visual hierarchy issues. Fixed with:

| Section | Before | After |
|---------|--------|-------|
| **GPS** | `text-sm font-mono` | `text-base font-mono`, `mt-2`, `leading-relaxed` |
| **Address** | `text-base` (16px) | `text-[15px]` (body standard), `leading-relaxed` |
| **Local** | `text-sm text-braun-900` | `text-sm text-braun-600`, `leading-relaxed` |
| **Region** | `text-sm text-braun-900` | `text-sm text-braun-500` (lighter), `leading-relaxed` |

The color gradient (900 → 600 → 500) creates visual hierarchy showing geographic progression from specific (address) to general (region) without needing labels.

---

## Files Modified

1. `packages/desktop/src/components/location/LocationMapSection.svelte`

---

## Visual Before/After

### Before
```
┌─────────────────────────────────────┐
│ Location                       edit │
├─────────────────────────────────────┤
│ GPS                                 │
│ 42.652600, -73.756200              │
│                                     │
│ ADDRESS                             │
│ 123 Main St, Albany, NY 12207      │
│                                     │
│ LOCAL                               │
│ Albany County - Capital District...│
│                                     │
│ REGION                              │
│ Northeast - United States - N.A.   │
│                                     │
│ [        Mini Map        ]         │
└─────────────────────────────────────┘
```

### After
```
┌─────────────────────────────────────┐
│ Location                       edit │
├─────────────────────────────────────┤
│                                     │
│ 42.652600, -73.756200              │  ← mono, primary (braun-900)
│                                     │
│ 123 Main St, Albany, NY 12207      │  ← body, primary (braun-900)
│                                     │
│ Albany County - Capital District...│  ← secondary (braun-600)
│                                     │
│ Northeast - United States - N.A.   │  ← tertiary (braun-500)
│                                     │
│ [        Mini Map        ]         │
└─────────────────────────────────────┘
```

---

## Implementation Checklist

- [x] Remove `<h3 class="section-title">GPS</h3>` and wrapper
- [x] Remove `<h3 class="section-title">Address</h3>` and wrapper
- [x] Remove `<h3 class="section-title">Local</h3>` and wrapper
- [x] Remove `<h3 class="section-title">Region</h3>` and wrapper
- [x] Remove "No coordinates available" empty state (hide section)
- [x] Remove "No address set" empty state (hide section)
- [x] Remove "No local information available" empty state (hide section)
- [x] Remove "No region information available" empty state (hide section)
- [x] Change "Copied!" position from `-right-2` to `right-0`
- [x] Change section spacing from `mt-4` to `mt-6`
- [x] Remove orphaned `.section-title` CSS class
- [x] Add `mt-2` to GPS section for breathing room after header
- [x] Increase GPS font size to `text-base font-mono`
- [x] Fix address font size to `text-[15px]`
- [x] Differentiate Local (`text-braun-600`) and Region (`text-braun-500`) colors
- [x] Add `leading-relaxed` to all text sections

---

## Risk Assessment

**Low risk** — Visual-only changes, no data or logic modifications.

---

## Braun Principles Addressed

- **#4 Understandable** — Color hierarchy makes geographic progression self-explanatory
- **#5 Unobtrusive** — Interface recedes, content speaks
- **#8 Thorough** — Every detail considered (spacing, typography, color)
- **#10 Minimal** — Only essential elements remain
