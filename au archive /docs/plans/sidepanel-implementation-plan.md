# Chrome Side Panel Implementation Plan

## Goal
Replace popup-based bookmarking with a persistent Side Panel that provides:
- Search locations with autocomplete
- Save bookmarks to selected/recent locations
- Create new locations directly from browser
- Real-time updates via WebSocket
- Premium research companion UX

---

## Current State Analysis

### What Exists
| Component | File | Status |
|-----------|------|--------|
| Manifest V3 | `resources/extension/manifest.json` | Basic popup config |
| Popup UI | `popup.html/js/css` | Working but limited |
| Background SW | `background.js` | Context menu, screenshot capture |
| HTTP API | `bookmark-api-server.ts` | REST endpoints on :47123 |

### What's Missing
- `sidePanel` permission in manifest
- `sidepanel.html/js/css` files
- WebSocket server for real-time sync
- Create location endpoint
- Side panel open/close management

---

## Architecture Decisions

### Communication Protocol
**Decision: Hybrid HTTP + WebSocket**

| Protocol | Use Case |
|----------|----------|
| HTTP POST | Save bookmark, create location |
| HTTP GET | Search locations, get recent |
| WebSocket | Real-time location list updates, status sync |

**Why WebSocket addition:**
- When user creates location in app → Side panel updates immediately
- When bookmark is saved → App shows toast without polling
- Connection status indicator (green/red dot)

### Side Panel vs Popup
**Decision: Side Panel with popup fallback**

The extension will:
1. Open Side Panel as primary UI (click extension icon)
2. Keep popup.html for browsers that don't support Side Panel
3. Context menu remains for quick saves

---

## File Changes

### 1. manifest.json (Modify)
```json
{
  "manifest_version": 3,
  "name": "AU Archive Clipper",
  "version": "1.1.0",
  "description": "Save pages to Abandoned Upstate Archive",

  "permissions": [
    "activeTab",
    "storage",
    "contextMenus",
    "sidePanel"          // NEW
  ],

  "host_permissions": [
    "http://localhost:47123/*",
    "ws://localhost:47124/*"   // NEW - WebSocket
  ],

  "action": {
    "default_icon": {...},
    "default_title": "Open AU Archive Panel"
  },

  "side_panel": {           // NEW SECTION
    "default_path": "sidepanel.html"
  },

  "background": {
    "service_worker": "background.js"
  },

  "icons": {...}
}
```

### 2. sidepanel.html (New File)
New persistent panel UI with:
- Header with connection status indicator
- Search input with autocomplete dropdown
- Recent locations list (clickable for quick save)
- "New Location" button → inline form
- Current page info (URL, title)
- Save button
- Bookmark history for current session

### 3. sidepanel.js (New File)
Logic for:
- WebSocket connection management (connect, reconnect, heartbeat)
- Location search with debounce
- Save bookmark handler
- Create new location handler
- Session bookmark history
- Real-time location list updates

### 4. sidepanel.css (New File)
Styles for:
- 300px fixed width panel
- Dark theme matching AU Archive app
- Connection status indicator (green/amber/red dot)
- Search input with dropdown
- Location cards
- Form inputs
- Success/error states

### 5. background.js (Modify)
Add:
- `chrome.sidePanel.open()` on action click
- `chrome.sidePanel.setOptions()` for per-tab behavior
- Remove popup opening logic (side panel replaces it)

### 6. bookmark-api-server.ts (Modify)
Add new endpoint:
- `POST /api/location` - Create new location from browser

### 7. websocket-server.ts (New File)
New WebSocket server on port 47124:
- Broadcasts location list changes
- Broadcasts bookmark saves
- Handles connection/disconnection
- Heartbeat/ping to keep connections alive

### 8. Electron main process (Modify)
- Start WebSocket server alongside HTTP server
- Emit events when locations/bookmarks change

---

## API Specification

### Existing HTTP Endpoints (Keep)
| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/status | Health check |
| POST | /api/bookmark | Save bookmark |
| GET | /api/locations?search= | Search locations |
| GET | /api/recent | Recent bookmarks |
| GET | /api/recent-locations | Recent locations |

### New HTTP Endpoint
| Method | Path | Purpose |
|--------|------|---------|
| POST | /api/location | Create new location |

**POST /api/location Request:**
```json
{
  "name": "Greystone Psychiatric Hospital",
  "state": "NJ",
  "type": "hospital"
}
```

**Response:**
```json
{
  "success": true,
  "locid": "uuid-here",
  "locnam": "Greystone Psychiatric Hospital"
}
```

### WebSocket Protocol (Port 47124)

**Connection:**
```
ws://localhost:47124
```

**Server → Client Messages:**
```json
// Location list updated
{
  "type": "locations_updated",
  "locations": [{ "locid": "...", "locnam": "...", "address_state": "..." }]
}

// Bookmark saved confirmation
{
  "type": "bookmark_saved",
  "bookmark_id": "...",
  "locid": "..."
}

// Heartbeat
{
  "type": "ping"
}
```

**Client → Server Messages:**
```json
// Subscribe to updates
{
  "type": "subscribe"
}

// Heartbeat response
{
  "type": "pong"
}
```

---

## UI Wireframe

```
┌─────────────────────────────────┐
│ AU Archive           [●] Online │  ← Header with status
├─────────────────────────────────┤
│ [🔍 Search locations...      ]  │  ← Search with autocomplete
├─────────────────────────────────┤
│ Recent Locations:               │
│ ┌─────────────────────────────┐ │
│ │ 📍 Greystone Psychiatric    │ │  ← Click to select
│ │    NJ                       │ │
│ └─────────────────────────────┘ │
│ ┌─────────────────────────────┐ │
│ │ 📍 Willard Asylum           │ │
│ │    NY                       │ │
│ └─────────────────────────────┘ │
│ ┌─────────────────────────────┐ │
│ │ 📍 Buffalo State Hospital   │ │
│ │    NY                       │ │
│ └─────────────────────────────┘ │
│                                 │
│ [+ New Location]                │  ← Expands inline form
├─────────────────────────────────┤
│ Current Page:                   │
│ ┌─────────────────────────────┐ │
│ │ Facebook - Greystone Photos │ │  ← Current tab title
│ │ facebook.com/groups/...     │ │  ← Truncated URL
│ └─────────────────────────────┘ │
├─────────────────────────────────┤
│ Save to: [Greystone Psychia ▼]  │  ← Dropdown or selected
│                                 │
│ [     💾 Save Bookmark      ]   │  ← Primary action
├─────────────────────────────────┤
│ Session History:                │
│ • facebook.com/photo... → Grey  │  ← Recent saves this session
│ • nytimes.com/article... → Grey │
│ • reddit.com/r/aband... → Inbox │
└─────────────────────────────────┘
```

---

## Implementation Steps

### Phase 1: Basic Side Panel (No WebSocket)
1. Create `sidepanel.html` with full UI structure
2. Create `sidepanel.css` with dark theme styles
3. Create `sidepanel.js` with HTTP-only logic
4. Update `manifest.json` with sidePanel permission
5. Update `background.js` to open side panel on click
6. Test basic save/search workflow

### Phase 2: New Location Creation
1. Add `POST /api/location` endpoint to API server
2. Add inline form to side panel UI
3. Wire up create location handler
4. Test creating location and immediately saving bookmark to it

### Phase 3: WebSocket Real-time Updates
1. Create `websocket-server.ts` in Electron services
2. Start WebSocket server in main process
3. Add WebSocket client to sidepanel.js
4. Emit location updates when database changes
5. Update side panel location list in real-time
6. Add connection status indicator

### Phase 4: Polish & Edge Cases
1. Handle offline/disconnected state gracefully
2. Add keyboard shortcuts (Enter to save)
3. Add session bookmark history
4. Handle long location names (truncation)
5. Test with Facebook, forums, login-protected sites

---

## Testing Checklist

### Functional Tests
- [ ] Side panel opens when clicking extension icon
- [ ] Search returns matching locations with autocomplete
- [ ] Selecting location enables save button
- [ ] Save bookmark works with selected location
- [ ] Save bookmark works without location (inbox)
- [ ] Create new location from panel works
- [ ] New location appears in list immediately
- [ ] Recent locations show correctly
- [ ] Session history tracks saves
- [ ] Context menu still works alongside panel

### Edge Cases
- [ ] App not running → Shows error, disables save
- [ ] WebSocket disconnects → Reconnect with backoff
- [ ] Very long location name → Truncated with ellipsis
- [ ] No locations exist → Shows "Create your first location"
- [ ] Search returns no results → Shows "No matches"
- [ ] Duplicate bookmark URL → Handled gracefully

### Performance Tests
- [ ] Panel opens in < 200ms
- [ ] Search responds in < 300ms
- [ ] Save completes in < 500ms
- [ ] WebSocket reconnects in < 5s

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Side Panel API not available | Low | High | Fallback to popup |
| WebSocket port conflict | Medium | Medium | Configurable port, fallback to polling |
| Content Security Policy blocks WS | Medium | Medium | Use HTTP polling as fallback |
| Performance with many locations | Low | Low | Virtual scrolling, limit results |

---

## Dependencies

### Chrome APIs Used
- `chrome.sidePanel` - Panel management
- `chrome.sidePanel.open()` - Open panel programmatically
- `chrome.sidePanel.setOptions()` - Configure panel behavior
- `chrome.tabs.query()` - Get current tab info
- `chrome.action.onClicked` - Handle icon click

### NPM Packages (Electron side)
- `ws` - WebSocket server (already common, or use built-in)

---

## CLAUDE.md Compliance Check

| Rule | Status | Notes |
|------|--------|-------|
| Scope Discipline | ✅ | Only implements requested bookmark panel |
| Archive-First | ✅ | Serves research workflow |
| Offline-First | ✅ | HTTP fallback when WebSocket fails |
| One Script = One Function | ✅ | Separate files for panel, background, server |
| No AI in Docs | ✅ | No AI mentions in UI |
| Keep It Simple | ✅ | Minimal abstraction, clear flow |
| Preload MUST be CommonJS | N/A | Extension code, not preload |

---

## Estimated Scope

| Phase | Files Changed | Lines of Code |
|-------|---------------|---------------|
| Phase 1 | 5 | ~400 |
| Phase 2 | 2 | ~100 |
| Phase 3 | 3 | ~200 |
| Phase 4 | 3 | ~100 |
| **Total** | **6 new, 3 modified** | **~800** |

---

## Approval Needed

Before proceeding with implementation:

1. ✅ Confirm Side Panel as primary UI (not toolbar bar)
2. ✅ Confirm WebSocket for real-time updates
3. ❓ Confirm location types for "New Location" dropdown
4. ❓ Confirm dark theme colors (match app or custom?)
5. ❓ Confirm session history persistence (memory only or localStorage?)
