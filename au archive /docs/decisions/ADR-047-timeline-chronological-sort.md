# ADR-047: Timeline Chronological Sort

**Status:** Accepted
**Date:** 2025-12-11
**Context:** Fix timeline display to use true chronological order (oldest first)

---

## Context

The LocationTimeline component displayed events using semantic bucketing rather than true chronological order:

**Previous (Broken) Order:**
```
XXXX-XX-XX - Built        (hardcoded first)
2021-01-31 - Site Visit   (newer visit shown before older)
2019-10-14 - Site Visit   (older visit shown after newer)
2025-12-12 - Added to DB  (hardcoded last despite being newest date)
```

**Issues Identified:**
1. Established event hardcoded to top regardless of date
2. Visits sorted descending (newest first) - counterintuitive for a timeline
3. Database entry hardcoded to bottom regardless of its actual date
4. Timeline violated historian expectations of oldest-to-newest reading order

---

## Decision

### 1. True Chronological Sort (Oldest First)

All timeline events are now sorted by `date_sort` ascending:

```typescript
let sortedEvents = $derived(
  [...events].sort((a, b) => {
    const aSort = a.event_type === 'established' && (a.date_sort === null || a.date_sort === 99999999)
      ? -1
      : (a.date_sort ?? 99999999);
    const bSort = b.event_type === 'established' && (b.date_sort === null || b.date_sort === 99999999)
      ? -1
      : (b.date_sort ?? 99999999);
    return aSort - bSort;
  })
);
```

### 2. Unknown Established Dates Pin to Top

Established events (Built, Opened, etc.) with unknown dates are sorted with effective value `-1`, ensuring they appear first.

Rationale: A building inherently existed before anyone visited it, so "Built" with unknown date is semantically the oldest event.

### 3. Unified Display Loop

The template now uses a single loop over chronologically sorted events instead of separate hardcoded sections:

```svelte
{#each displayEvents() as event (event.event_id)}
  {#if event.event_type === 'established'}...{/if}
  {:else if event.event_type === 'visit'}...{/if}
  {:else if event.event_type === 'database_entry'}...{/if}
{/each}
```

### 4. Visit Collapse Logic Inverted

Previously: "Show N earlier visits" (hid older visits)
Now: "Show N more recent visits" (hides newer visits)

Since oldest visits are shown first, the hidden ones are the newer ones.

---

## New Behavior

```
XXXX-XX-XX - Built        (top: unknown = inherently oldest)
2019-10-14 - Site Visit   (chronological)
2021-01-31 - Site Visit   (chronological)
2025-12-12 - Added to DB  (naturally last due to newest date_sort)
```

---

## Consequences

### Positive

1. **Historian-friendly:** Timeline reads oldest-to-newest like archival records
2. **Consistent:** All events sorted by same algorithm
3. **Accurate:** Database entry appears in correct chronological position
4. **Simpler:** Single sorting function, no hardcoded sections

### Negative

1. **UI change:** Users may notice different order
2. **Visit collapse:** Hidden visits are now the newer ones

### Neutral

1. **Visual styling preserved:** Dot types (filled, hollow, square) unchanged
2. **Edit functionality preserved:** Established date editing unchanged

---

## Files Modified

| File | Change |
|------|--------|
| `packages/desktop/src/components/location/LocationTimeline.svelte` | Sorting logic, template structure, collapse behavior |

---

## Implementation Guide

### For Developers

The key change is in the `sortedEvents` derived state:

1. **Sort key calculation:**
   - Established events with unknown date: `-1` (always first)
   - Events with known date: use `date_sort` value (YYYYMMDD format)
   - Events with unknown date: `99999999` (last)

2. **Display list construction:**
   - `displayEvents()` returns all events with visit collapsing applied
   - First N oldest visits shown, newer visits hidden behind "Show more" button

3. **Template iteration:**
   - Single `{#each}` loop over `displayEvents()`
   - Event type determines visual styling (dot shape, text color)

### Testing Checklist

- [ ] Established with unknown date appears first
- [ ] Established with known date sorts chronologically
- [ ] Visits appear in oldest-to-newest order
- [ ] Database entry appears in correct date position
- [ ] "Show more recent visits" reveals newer visits
- [ ] Edit mode still functions for established dates

---

**Approved by:** Project Owner
**Implementation:** Complete
