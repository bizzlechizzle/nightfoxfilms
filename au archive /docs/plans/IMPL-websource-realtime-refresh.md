# Implementation Guide: Web Source Real-Time Refresh

**Date:** 2025-12-14
**Status:** COMPLETE
**CLAUDE.md Rule:** #9 - Real-Time UI Updates

---

## Problem Statement

When a user saves a bookmark from the browser extension:
1. Bookmark IS saved correctly to database ✓
2. UI does NOT refresh to show the new bookmark ✗
3. "Websites" section is hidden inside collapsed "Records" accordion ✗
4. User has no feedback that save succeeded ✗

---

## Root Cause Analysis

### Database Layer: WORKING
```sql
-- Bookmark exists in database
SELECT source_id, url, locid FROM web_sources WHERE locid = '4a87aaff6d77a64f';
-- Returns: 68e4e6a765701c77 | redfin.com/... | 4a87aaff6d77a64f
```

### IPC Layer: WORKING
- `websources:findByLocation` handler correctly queries repository
- Zod validation passes for Blake3 IDs

### UI Layer: PROBLEMS
1. `LocationRecords` accordion is collapsed by default (`isOpen = $state(false)`)
2. `LocationWebSources` is nested inside `LocationRecords`
3. No notification when bookmark is saved externally
4. Previous fix added IPC listener but Records stays collapsed

---

## Implementation Plan

### Change 1: IPC Notification (DONE)
**File:** `packages/desktop/electron/services/websocket-server.ts`
- Added `BrowserWindow.getAllWindows().forEach()` to send `websource:saved` IPC

### Change 2: Preload Exposure (DONE)
**File:** `packages/desktop/electron/preload/preload.cjs`
- Added `onWebSourceSaved` listener in websources API

### Change 3: TypeScript Types (DONE)
**File:** `packages/desktop/src/types/electron.d.ts`
- Added type for `onWebSourceSaved` callback

### Change 4: Component Listener (DONE)
**File:** `packages/desktop/src/components/location/LocationWebSources.svelte`
- Added `onMount` with `onWebSourceSaved` listener

### Change 5: Auto-Expand Records (NEW)
**File:** `packages/desktop/src/components/location/LocationRecords.svelte`
- Export `expandWebSources()` function
- Add own `onWebSourceSaved` listener that calls expand + reload

### Change 6: Toast Notification (NEW)
**File:** `packages/desktop/src/pages/LocationDetail.svelte`
- Add listener for `websource:saved` at page level
- Show toast "Bookmark saved" when source added to current location

### Change 7: Visual Indicator (NEW)
**File:** `packages/desktop/src/components/location/LocationRecords.svelte`
- Show badge on "Records" header when new sources exist
- Pulse animation to draw attention

---

## Code Changes

### Change 5: Auto-Expand Records

```svelte
// LocationRecords.svelte - Add at top of script
import { onMount } from 'svelte';

// Add after isOpen state
let websourcesCount = $state(0);
let hasNewSources = $state(false);

// Export expand function
export function expandAndScrollToWebsources() {
  isOpen = true;
  hasNewSources = false;
  // Scroll to websources section after DOM update
  setTimeout(() => {
    document.getElementById('websources-section')?.scrollIntoView({ behavior: 'smooth' });
  }, 100);
}

// Add listener
onMount(() => {
  const unsubscribe = window.electronAPI?.websources?.onWebSourceSaved?.((payload) => {
    if (payload.locid === locid) {
      hasNewSources = true;
      // Auto-expand when new source added
      isOpen = true;
    }
  });
  return () => unsubscribe?.();
});
```

### Change 6: Toast Notification

```svelte
// LocationDetail.svelte - Add to script section
import { onMount } from 'svelte';

// Add state for toast
let toastMessage = $state<string | null>(null);
let toastTimeout: ReturnType<typeof setTimeout> | null = null;

function showToast(message: string) {
  toastMessage = message;
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toastMessage = null;
  }, 3000);
}

// Add listener in onMount or existing effect
onMount(() => {
  const unsubscribe = window.electronAPI?.websources?.onWebSourceSaved?.((payload) => {
    if (payload.locid === locationId) {
      showToast('Bookmark saved');
      // Expand records section
      recordsRef?.expandAndScrollToWebsources();
    }
  });
  return () => unsubscribe?.();
});
```

---

## Testing Checklist

- [ ] Save bookmark from extension while viewing location
- [ ] Verify toast appears "Bookmark saved"
- [ ] Verify Records accordion auto-expands
- [ ] Verify Websites section shows new source
- [ ] Verify no refresh required
- [ ] Verify works for sub-locations
- [ ] Verify cleanup on component unmount

---

## Files Modified

| File | Changes |
|------|---------|
| `websocket-server.ts` | IPC send to renderer |
| `preload.cjs` | onWebSourceSaved listener |
| `electron.d.ts` | TypeScript types |
| `LocationWebSources.svelte` | Auto-refresh on event |
| `LocationRecords.svelte` | Auto-expand, badge indicator |
| `LocationDetail.svelte` | Toast notification, ref to records |

---

## Rollback

All changes are additive. Revert commits if issues arise.
