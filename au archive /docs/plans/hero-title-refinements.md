# Hero Title Overlap - Implementation Plan

## Audit Summary

**Current Structure (after rollback):**
```
LocationHero (line 760-773)
  └── Outer wrapper: bg-[#fffbf7]
  └── Inner: Hero image with gradient fade (bottom 80%, fades to #fffbf7)

Title Section (line 776-795)
  └── Container: max-w-6xl mx-auto px-8 pt-2 pb-2
  └── h1.hero-title (88% width, 128px max, binary search sizing)
  └── button.host-tagline (sub-location only, 18px, 90% width)

Info Section (line 797+)
  └── Container: max-w-6xl mx-auto px-8 pb-8
  └── LocationInfo + LocationMapSection grid
```

**Problem Analysis - Why Previous Attempts Failed:**

1. **Attempt 1 (-mt-12 + z-10):** Title got cut off because LocationHero's outer `<div class="bg-[#fffbf7]">` creates a solid "floor" under the hero image. The title's negative margin pulled it behind this floor.

2. **Attempt 2 (absolute positioning):** Broke document flow entirely - title lost its position in layout.

**Key Insight:** The gradient inside the hero (lines 128-142 of LocationHero) already fades from transparent → solid #fffbf7. The title needs to sit IN this gradient zone, not behind the outer wrapper's background.

---

## Solution

Use negative margin with high z-index to float title OVER the hero gradient:

| Property | Purpose |
|----------|---------|
| `relative` | Create stacking context |
| `z-20` | Higher than hero (default z-auto) to appear on top |
| `-mt-12` | Pull title up 3rem into gradient zone |
| `pb-4` | Bottom padding before info section |

Info section gets `pt-6` for more negative space.

---

## Implementation Steps

### Step 1: Title container overlap
**File:** `LocationDetail.svelte:776`
```diff
- <div class="max-w-6xl mx-auto px-8 pt-2 pb-2">
+ <div class="max-w-6xl mx-auto px-8 pb-4 relative z-20 -mt-12">
```

### Step 2: More negative space before info boxes
**File:** `LocationDetail.svelte:797`
```diff
- <div class="max-w-6xl mx-auto px-8 pb-8">
+ <div class="max-w-6xl mx-auto px-8 pt-6 pb-8">
```

---

## Why This Works

1. **z-20 > default:** Title stacking context sits above hero's default stacking
2. **relative:** Required for z-index to work
3. **-mt-12:** Pulls title up 3rem (48px) into the gradient zone
4. **Gradient provides contrast:** The gradient already transitions from image → #fffbf7, so title text (dark gray #454545 with gold shadow) remains readable

---

## Files Changed

| File | Line | Change |
|------|------|--------|
| `src/pages/LocationDetail.svelte` | 776 | Title container: add `relative z-20 -mt-12`, change padding |
| `src/pages/LocationDetail.svelte` | 797 | Info container: add `pt-6` for negative space |

---

## Testing Checklist

- [ ] Title overlaps hero gradient (visible in gradient zone)
- [ ] Title is ON TOP of hero image (not hidden behind)
- [ ] Negative space before info/location boxes looks balanced
- [ ] Host location page works
- [ ] Sub-location page works (with host tagline visible)
- [ ] Standard location page works
- [ ] Resize window: title still fits 2 lines max

---

## Visual Target

```
┌─────────────────────────────────┐
│         HERO IMAGE              │
│                                 │
│      ░░░ gradient ░░░           │
│    ░░░░░░░░░░░░░░░░░░░░         │
│  ═══════════════════════════    │ ← Title overlaps HERE
│       LOCATION TITLE            │    (in gradient zone)
│        host tagline             │
│                                 │
│   ~~~~ negative space ~~~~      │
│                                 │
│  ┌─────────┐  ┌─────────┐       │
│  │  Info   │  │   Map   │       │
│  │  Box    │  │   Box   │       │
│  └─────────┘  └─────────┘       │
└─────────────────────────────────┘
```
