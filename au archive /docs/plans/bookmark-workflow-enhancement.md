# Bookmark Workflow Enhancement Plan

## Current State

### What Exists
1. **Bookmarks Table**: `bookmark_id`, `url`, `title`, `locid` (nullable FK), `bookmark_date`, `auth_imp`, `thumbnail_path`
2. **Browser Extension** (AU Archive Clipper):
   - Popup UI with location search
   - Context menu "Save to AU Archive" (right-click on page/link)
   - Connects to localhost:47123 API
3. **API Server**: `bookmark-api-server.ts` on port 47123
4. **App UI**:
   - `Bookmarks.svelte` - Central bookmarks page (all bookmarks)
   - `LocationBookmarks.svelte` - Per-location bookmark section
   - Dashboard shows recent bookmarks

### Current Workflow
1. User clicks extension icon → popup with location search → save
2. Right-click "Save to AU Archive" → saves WITHOUT location (goes to inbox)
3. Bookmarks with `locid=null` are "unassigned" (inbox)

---

## Proposed Enhancements

### Phase 1: Context Menu with Location Picker (Recommended First)
**Problem**: Right-click saves to inbox without location assignment
**Solution**: Enhance context menu with dynamic sub-menu showing recent locations

```
Right-click → "Save to AU Archive" →
  ├── "Quick Save (Inbox)"
  ├── "─────────────────"
  ├── "Greystone Psychiatric"   ← Recent location 1
  ├── "Willard Asylum"          ← Recent location 2
  ├── "Buffalo State Hospital"  ← Recent location 3
  └── "Choose Location..."      ← Opens popup for full search
```

**Implementation**:
- Modify `background.js` to fetch recent locations on context menu show
- Use `chrome.contextMenus.update()` to dynamically populate sub-items
- API endpoint `/api/recent-locations` returns last 5 used locations

### Phase 2: Keyboard Shortcut
**Problem**: No quick way to save while hands on keyboard
**Solution**: Add keyboard shortcut (e.g., Ctrl+Shift+S)

- Opens popup directly OR
- Quick-saves to inbox with badge confirmation

### Phase 3: Bookmark Inbox in App
**Problem**: Unassigned bookmarks need a clear triage workflow
**Solution**: Dedicated "Inbox" section in Bookmarks page

- Filter toggle: "Inbox" (locid=null) vs "All" vs "By Location"
- Bulk assign: Select multiple bookmarks → assign to location
- Quick-assign dropdown on each bookmark row

### Phase 4: Thumbnail Capture (Premium Feature)
**Problem**: Hard to remember what a bookmark was about
**Solution**: Capture page screenshot when bookmarking

- Use puppeteer (already available) to capture visible viewport
- Store as thumbnail in `resources/thumbs/bookmarks/`
- Display in bookmark lists for visual recognition

### Phase 5: Page Archive (Future - SingleFile Integration)
**Problem**: Pages change or disappear over time
**Solution**: Archive full page HTML for offline access

- Integrate SingleFile or similar for complete page capture
- Store archived pages locally
- Facebook/login pages work because Chromium session persists

---

## Best Practices Assessment

### Should We Build a Toolbar?
**No** - Manifest V3 extensions use the action button (puzzle piece icon) as the toolbar. The current popup IS the toolbar interface. Adding a persistent toolbar bar would:
- Clutter the browser
- Require more complex content script injection
- Not be necessary given the action button + context menu

### Bookmark Organization Model
**Recommended**: Two-tier inbox model

1. **Quick Capture** (context menu, keyboard) → Inbox (locid=null)
2. **Full Save** (popup with location search) → Assigned to location
3. **Triage Later** → Assign inbox items in app

This matches research workflows: capture first, organize later.

### Per-Location Bookmark Map?
**Already exists**: `LocationBookmarks.svelte` shows bookmarks for each location. Enhancement would be:
- Show bookmark count badge on location cards
- Add "Bookmarks" section to location detail page sidebar navigation
- Group bookmarks by type (article, social, video, etc.)

### Right-Click "Add to Location"?
**Partially exists**: Context menu saves to inbox. Enhancement per Phase 1 above adds location quick-select.

---

## Recommended Implementation Order

1. **Phase 3: Bookmark Inbox UI** - Lowest effort, immediate value
   - Add filter to Bookmarks.svelte for inbox/assigned
   - Add quick-assign dropdown to each row
   - ~2 hours

2. **Phase 1: Context Menu Enhancement** - Medium effort, high value
   - Dynamic context menu with recent locations
   - New API endpoint for recent locations
   - ~3 hours

3. **Phase 2: Keyboard Shortcut** - Low effort
   - Add command to manifest.json
   - Handle in background.js
   - ~1 hour

4. **Phase 4: Thumbnails** - Medium effort, nice-to-have
   - Puppeteer screenshot capture
   - Thumbnail storage and display
   - ~4 hours

5. **Phase 5: Page Archive** - High effort, future
   - SingleFile integration research
   - Storage management
   - ~8+ hours

---

## Schema Considerations

Current `bookmarks` table is sufficient for Phases 1-3.

For Phase 4 (thumbnails), `thumbnail_path` column already exists.

For Phase 5 (page archive), would need:
```sql
ALTER TABLE bookmarks ADD COLUMN archive_path TEXT;
ALTER TABLE bookmarks ADD COLUMN archived_at TEXT;
ALTER TABLE bookmarks ADD COLUMN archive_size INTEGER;
```

---

## Decision: Thumbnails = Medium (400px), Page Archive = Defer

---

## Detailed Option Analysis: What to Build First

### Option A: Inbox UI (App-Side)

**What it does**: Improves the Bookmarks page in the Electron app

**Changes**:
- Add filter tabs: "Inbox" | "Assigned" | "All"
- Add quick-assign dropdown on each bookmark row
- Bulk selection + assign to location
- Badge showing inbox count on nav

**Effort**: ~2 hours
**Complexity**: Low (UI changes only, existing APIs)

**Pros**:
- Immediate value for existing bookmarks
- Clean up current workflow
- No extension changes needed

**Cons**:
- Doesn't improve the CAPTURE experience (still saves to inbox without location)
- User still has to triage later

**Best for**: Users who already have bookmarks piling up and need organization

---

### Option B: Context Menu Enhancement (Browser-Side)

**What it does**: Makes right-click menu smarter with location options

**Changes**:
- Dynamic context menu with recent locations
- New API endpoint `/api/recent-locations`
- Sub-menu: Quick Save | Location 1 | Location 2 | Location 3 | Choose...

**Effort**: ~3 hours
**Complexity**: Medium (Chrome extension APIs, dynamic menus)

**Pros**:
- Faster workflow while browsing
- Fewer unassigned bookmarks created
- One-click to assign to frequently used locations

**Cons**:
- Limited to 5-6 recent locations in menu
- Still need popup for full search
- Doesn't help organize existing inbox

**Best for**: Users actively researching new locations who want speed

---

### Option C: Both Together

**Changes**: Combine A + B

**Effort**: ~5 hours
**Complexity**: Medium

**Pros**:
- Complete solution: better capture AND better organization
- No workflow gaps

**Cons**:
- More to test
- Longer before either ships

---

### Option D: Thumbnail Capture First

**What it does**: Add visual previews to bookmarks

**Changes**:
- Modify bookmark creation to trigger screenshot
- Use puppeteer to capture 400px thumbnail
- Store in `resources/thumbs/bookmarks/`
- Display thumbnails in bookmark lists

**Effort**: ~4 hours
**Complexity**: Medium (puppeteer integration, file storage)

**Pros**:
- Visual memory aid ("what was that page?")
- Premium feel to the bookmark UI
- Works with login-protected pages (uses browser session)

**Cons**:
- Doesn't solve organization problem
- Adds storage overhead
- Slight delay on bookmark save

**Best for**: Visual thinkers who forget what they bookmarked

---

## My Recommendation: Option B First, Then D, Then A

**Why this order**:

1. **Context Menu (B) first** - The bottleneck is capture friction. Currently:
   - Click extension → search location → save = 5+ seconds
   - Right-click → save = 2 seconds but no location

   With enhanced context menu:
   - Right-click → recent location → save = 2 seconds WITH location

   This prevents the inbox problem from growing.

2. **Thumbnails (D) second** - You confirmed medium (400px). This adds:
   - Visual context when browsing bookmarks
   - Helps identify pages months later
   - Works with Facebook/login pages since Chromium session persists

3. **Inbox UI (A) last** - With better capture (B) and visual aids (D), the inbox becomes smaller. Still worth doing for cleanup, but lower priority.

---

## Alternative Recommendation: D First (Thumbnails)

If the workflow is "browse a lot, organize later", then thumbnails first makes sense:

1. **Thumbnails first** - Every bookmark gets a visual preview
2. **Context menu second** - Speed up capture
3. **Inbox UI third** - Organize the backlog

This works if you're okay with current inbox behavior and want visual polish before speed.

---

## What Would I Do?

**I'd build B (Context Menu) first** because:

1. **Research workflow**: When documenting abandoned places, you're often in a flow - finding articles, photos, forum posts. Each right-click interruption to open popup breaks flow.

2. **Location affinity**: Most research sessions focus on 1-3 locations. Having those in right-click menu = zero friction.

3. **Compound benefit**: Every bookmark saved with location = one less inbox item to triage later.

4. **The "inbox zero" path**: If capture is easy and assigns location, inbox stays small. If capture is friction, inbox grows faster than you can triage.

Then add thumbnails to make the visual experience premium, then polish the inbox UI for the stragglers.
