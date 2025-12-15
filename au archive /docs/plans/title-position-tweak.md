# Title Position Tweak - Implementation Plan

## Full Audit

### Current Title Structure (LocationDetail.svelte:776-795)

```html
<!-- Title container -->
<div class="max-w-6xl mx-auto px-8 pb-4 relative z-20 -mt-12">
  <div class="w-[88%] mx-auto text-center">

    <!-- Main title (h1) -->
    <h1 class="hero-title font-bold uppercase leading-tight text-center mb-0"
        style="font-size: {heroTitleFontSize}px;">
      {heroDisplayName}
    </h1>

    <!-- Host tagline - ONLY on sub-location pages -->
    {#if isViewingSubLocation}
      <button class="host-tagline block w-[90%] mx-auto mt-0 uppercase hover:underline text-center">
        {location.locnam}
      </button>
    {/if}

  </div>
</div>
```

### Current Host Tagline CSS (lines 1098-1104)

```css
.host-tagline {
  color: var(--color-accent, #b9975c);  /* Gold accent */
  font-size: 18px;                       /* TINY */
  letter-spacing: 0.08em;
  font-weight: 700;
  white-space: nowrap;                   /* Single line always */
}
```

### Verification Checklist

| Requirement | Status | Evidence |
|-------------|--------|----------|
| Host tagline = TINY | ✅ YES | 18px font-size |
| Host tagline = CLICKABLE | ✅ YES | `<button>` with `hover:underline` |
| Host tagline = LINK behavior | ✅ YES | `onclick={() => router.navigate(...)}` |
| Host tagline only on sub-locations | ✅ YES | `{#if isViewingSubLocation}` |

---

## User Request

> "Bring the main title down just a smidge"

### Current Position
- Container has `-mt-12` (negative margin = -3rem = -48px)
- Title overlaps INTO the hero gradient by 48px

### Target Position
- Reduce overlap by a small amount ("smidge")
- Change from `-mt-12` to `-mt-10` (8px less overlap)

```
Current (-mt-12):           Target (-mt-10):

  ░░ gradient ░░              ░░ gradient ░░
  ░░░░░░░░░░░░░░░░            ░░░░░░░░░░░░░░░░
═══ TITLE HERE ═══            ░░░░░░░░░░░░░░░░
                            ═══ TITLE HERE ═══

  (48px overlap)              (40px overlap)
```

---

## Implementation

### Single Change

**File:** `LocationDetail.svelte:776`

```diff
- <div class="max-w-6xl mx-auto px-8 pb-4 relative z-20 -mt-12">
+ <div class="max-w-6xl mx-auto px-8 pb-4 relative z-20 -mt-10">
```

| Property | Before | After | Delta |
|----------|--------|-------|-------|
| Negative margin | -3rem (48px) | -2.5rem (40px) | +8px down |

---

## Files Changed

| File | Line | Change |
|------|------|--------|
| `LocationDetail.svelte` | 776 | `-mt-12` → `-mt-10` |

---

## Testing Checklist

- [ ] Title moves down slightly (8px less overlap with gradient)
- [ ] Host tagline still displays correctly (18px, gold, clickable)
- [ ] Works on location page
- [ ] Works on host-location page
- [ ] Works on sub-location page (with host tagline visible)
