# Bookmark Workflow: Next Tweak Decision

## Current State Summary

**What's Already Built:**

| Component | Status | Notes |
|-----------|--------|-------|
| Right-click → Save to Location | ✅ DONE | Dynamic context menu with recent locations |
| Extension Popup (toolbar) | ✅ DONE | Location search, quick-save buttons |
| API Server (port 47123) | ✅ DONE | `/bookmark`, `/locations`, `/recent-locations` |
| Bookmarks Database | ✅ DONE | Full CRUD, nullable `locid` FK |
| Bookmarks Page | ✅ DONE | List all, manual add, delete |
| Per-Location Bookmarks | ✅ DONE | `LocationBookmarks.svelte` component |

**What's NOT Built:**

| Component | Blocks? | Notes |
|-----------|---------|-------|
| Research Browser nav button | Yes | No way to launch browser from app |
| Keyboard shortcut (Ctrl+Shift+S) | No | Would speed up power users |
| Inbox filter UI | No | Can't filter unassigned bookmarks |
| Quick-assign dropdown | No | Must delete + re-add to change location |
| Thumbnail capture | No | Visual aid for recognition |

---

## The "Toolbar" Question

**Answer: The toolbar already exists.**

The extension popup IS the toolbar interface. Manifest V3 extensions use the action button (puzzle piece icon). Building a persistent browser toolbar bar would:
- Clutter the browser permanently
- Require complex content script injection
- Add no value over current popup + context menu

**Recommendation: Do NOT build a separate toolbar.**

---

## The "Right-Click Add to Location" Question

**Answer: This is already implemented!**

Current right-click menu structure:
```
Save to AU Archive
├── Quick Save (Inbox)
├── ────────────────────
├── [Recent Location 1]
├── [Recent Location 2]
├── [Recent Location 3]
├── ────────────────────
└── Choose Location...
```

This was implemented in the uncommitted changes to `background.js` and `bookmark-api-server.ts`.

---

## Best Options for Next Tweak

### Option A: Complete the Launch Flow (Recommended)
**Add "Research" button to app navigation**

**What it does:**
- Add button to nav bar → launches Ungoogled Chromium
- Show green indicator when browser is running
- Button toggles to "Focus Browser" when already open

**Why it matters:**
- Currently NO WAY to launch browser from app
- Users have to manually find Chromium
- Breaks the "premium" experience

**Effort:** ~1 hour
**Impact:** Unblocks entire workflow

---

### Option B: Inbox Triage UI
**Add filter and quick-assign to Bookmarks page**

**What it does:**
- Filter tabs: "Inbox" | "Assigned" | "All"
- Quick-assign dropdown on each bookmark row
- Bulk select + assign to location
- Inbox count badge on nav

**Why it matters:**
- Bookmarks saved without location need organization
- Currently must delete + re-add to change location
- No visibility into unassigned backlog

**Effort:** ~2 hours
**Impact:** Clean up existing data

---

### Option C: Keyboard Shortcut
**Ctrl+Shift+S for instant bookmark**

**What it does:**
- Keyboard shortcut saves current page
- Either: Quick-save to inbox with badge confirmation
- Or: Opens popup for location selection

**Why it matters:**
- Power users don't lift hands from keyboard
- Faster than right-click

**Effort:** ~1 hour
**Impact:** Speed improvement

---

### Option D: Thumbnail Capture
**Screenshot preview for every bookmark**

**What it does:**
- On bookmark save, capture 400px thumbnail
- Store in archive folder
- Display thumbnails in bookmark lists

**Why it matters:**
- Visual memory ("what was that page?")
- Works with login-protected pages (session persists)
- Premium archive feel

**Effort:** ~3-4 hours
**Impact:** Visual polish

---

### Option E: Commit Current Changes
**Lock in what's already built**

**What it does:**
- Commit the dynamic context menu enhancement
- Commit the `/api/recent-locations` endpoint
- Clean up and document

**Why it matters:**
- Uncommitted changes could be lost
- Creates checkpoint before new work
- Allows testing in clean state

**Effort:** 10 minutes
**Impact:** Foundation stability

---

## Recommended Order

1. **Option E: Commit first** - Lock in context menu work
2. **Option A: Research button** - Unblock the workflow
3. **Option B: Inbox UI** - Organize the backlog
4. **Option C: Keyboard shortcut** - Speed for power users
5. **Option D: Thumbnails** - Visual premium feel

---

## Decision Needed

Which option(s) should we implement next?

- [ ] A - Research Browser nav button
- [ ] B - Inbox triage UI
- [ ] C - Keyboard shortcut
- [ ] D - Thumbnail capture
- [ ] E - Commit current changes first
- [ ] Other - (specify)

**My recommendation: E → A → B**

Commit the context menu work, add the Research button to complete the launch flow, then build the inbox UI for organization.
