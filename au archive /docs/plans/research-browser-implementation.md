# Research Browser Implementation Plan

## Goal

Replace the embedded "Browser" page with a "Research" navigation item that launches Ungoogled Chromium in a separate window. All bookmark/location features will live in a pre-installed browser extension.

## User Story

As a researcher, I want to:
1. Click "Research" in the navigation menu
2. Have a de-Googled browser open in a separate window
3. Browse any website (including Facebook, forums requiring login)
4. Save bookmarks to my AU Archive locations using an extension
5. Have my logins persist for future archiving workflows

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  AU ARCHIVE ELECTRON APP                                                    │
│                                                                             │
│  Navigation: Dashboard | Locations | Research | Atlas                       │
│                                       ↓                                     │
│                              Launches browser                               │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  ResearchBrowserService                                              │   │
│  │  - electron/services/research-browser-service.ts                     │   │
│  │  - Uses puppeteer-core to launch Ungoogled Chromium                  │   │
│  │  - Manages browser lifecycle (launch, close, status)                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  BookmarkAPIServer                                                   │   │
│  │  - electron/services/bookmark-api-server.ts                          │   │
│  │  - HTTP server on localhost:47123                                    │   │
│  │  - Receives bookmarks from browser extension                         │   │
│  │  - Provides location search for extension autocomplete               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    puppeteer-core launches
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  UNGOOGLED CHROMIUM (resources/browsers/ungoogled-chromium/)                │
│                                                                             │
│  - De-Googled: No telemetry, no Google APIs                                 │
│  - License: BSD-3-Clause (OK to bundle)                                     │
│  - Profile stored in: ~/.au-archive/research-browser/                       │
│  - Extension pre-loaded from: resources/extension/                          │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  AU Archive Clipper Extension                                        │   │
│  │  - Popup with bookmark form                                          │   │
│  │  - Location search/autocomplete                                      │   │
│  │  - Quick save to recent locations                                    │   │
│  │  - Calls localhost:47123/api/* endpoints                             │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## CLAUDE.md Compliance Checklist

| Rule | How We Comply |
|------|---------------|
| Scope Discipline | Only implementing Research browser launch + extension bookmark save |
| Archive-First | Enables research workflow for finding location history |
| Prefer Open Source | Ungoogled Chromium (BSD-3), puppeteer-core (Apache-2.0) |
| Offline-First | Browser works offline, extension saves to local DB |
| Binary Dependencies Welcome | Ungoogled Chromium (~150MB) acceptable |
| Keep It Simple | Minimal services, extension handles all UI |
| IPC channel naming | `research:launch`, `research:status`, `research:close` |
| No AI in docs/UI | No AI mentions anywhere |
| Database via migrations | No schema changes needed for Step 1 |

## Files to Create

### 1. electron/services/research-browser-service.ts
- Launch Ungoogled Chromium via puppeteer-core
- Manage browser lifecycle
- Track browser state (running/closed)

### 2. electron/services/bookmark-api-server.ts
- HTTP server on port 47123
- Endpoints: /api/status, /api/bookmark, /api/locations, /api/recent
- CORS headers for extension access
- Security: localhost only

### 3. electron/main/ipc-handlers/research-browser.ts
- IPC handlers for launch, status, close
- Channel names: `research:launch`, `research:status`, `research:close`

### 4. resources/extension/manifest.json
- Manifest V3 format
- Permissions: activeTab, storage
- Host permissions: http://localhost:47123/*

### 5. resources/extension/popup.html + popup.js
- Bookmark form UI
- Location search with autocomplete
- Recent locations quick-save
- Save button

### 6. resources/extension/background.js
- Service worker for extension
- Badge updates
- Context menu integration

### 7. resources/extension/icons/
- icon16.png, icon48.png, icon128.png
- AU Archive branding

## Files to Modify

### 1. packages/desktop/src/components/Navigation.svelte
- Change "Browser" → "Research"
- On click: call `research:launch` instead of navigating

### 2. packages/desktop/electron/main/index.ts
- Initialize BookmarkAPIServer on app start
- Initialize ResearchBrowserService
- Clean up on app quit

### 3. packages/desktop/electron/preload/index.ts
- Add research browser IPC methods

### 4. packages/desktop/electron/preload/preload.cjs
- Add research browser bridge

### 5. packages/desktop/package.json
- Add puppeteer-core dependency

## Files to Delete

### 1. packages/desktop/src/pages/WebBrowser.svelte
- No longer needed (features move to extension)

### 2. packages/desktop/electron/services/browser-view-manager.ts
- Replace with research-browser-service.ts

## API Endpoints

### GET /api/status
Response: `{ running: true, version: "1.0.0" }`

### POST /api/bookmark
Request:
```json
{
  "url": "https://example.com/page",
  "title": "Page Title",
  "locid": "abc123" // optional
}
```
Response: `{ success: true, bookmark_id: "xyz789" }`

### GET /api/locations?search=query
Response:
```json
{
  "locations": [
    { "locid": "abc123", "locnam": "Hudson Mill", "address_state": "NY" }
  ]
}
```

### GET /api/recent?limit=5
Response:
```json
{
  "bookmarks": [
    { "bookmark_id": "...", "url": "...", "title": "...", "locnam": "..." }
  ]
}
```

## Extension UI Mockup

```
┌──────────────────────────────────────────────────────────┐
│  AU Archive Clipper                                 [×]  │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Save Bookmark                                           │
│  ─────────────────────────────────────────────────────   │
│                                                          │
│  URL: facebook.com/photos/123...                         │
│                                                          │
│  Title: [Old Mill Photos - 1985                     ]    │
│                                                          │
│  Location: [Search...                              ] ▼   │
│            ┌────────────────────────────────────────┐    │
│            │ Hudson River Mill (NY)                 │    │
│            │ Albany Warehouse (NY)                  │    │
│            │ + Create New Location                  │    │
│            └────────────────────────────────────────┘    │
│                                                          │
│  [💾 Save Bookmark]                                      │
│                                                          │
│  ─────────────────────────────────────────────────────   │
│                                                          │
│  Quick Save:                                             │
│  [Hudson Mill] [Albany] [Schenectady] [+]               │
│                                                          │
│  ─────────────────────────────────────────────────────   │
│                                                          │
│  Recent: 3 bookmarks today                               │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

## Dependencies to Add

| Package | Version | License | Purpose |
|---------|---------|---------|---------|
| puppeteer-core | ^22.0.0 | Apache-2.0 | Launch browser without bundled Chromium |

## Binary to Bundle

| Binary | Platform | Size | Source |
|--------|----------|------|--------|
| Ungoogled Chromium | macOS arm64 | ~150MB | ungoogled-software.github.io |
| Ungoogled Chromium | macOS x64 | ~150MB | ungoogled-software.github.io |
| Ungoogled Chromium | Windows x64 | ~150MB | ungoogled-software.github.io |
| Ungoogled Chromium | Linux x64 | ~150MB | ungoogled-software.github.io |

Note: Only ship platform-specific binary in release builds.

## Testing Checklist

- [ ] Click "Research" → browser launches
- [ ] Browser uses correct profile directory
- [ ] Extension is pre-installed and visible
- [ ] Extension popup opens
- [ ] Location search returns results
- [ ] Save bookmark works
- [ ] Bookmark appears in AU Archive app
- [ ] Close browser → status updates
- [ ] Relaunch browser works
- [ ] Logins persist between sessions

## Rollback Plan

If issues arise:
1. Revert Navigation.svelte to use "Browser" with router.navigate
2. Keep browser-view-manager.ts as fallback
3. WebBrowser.svelte remains available at /browser route

## Success Criteria

1. User clicks "Research" → Ungoogled Chromium opens
2. Extension allows saving bookmarks with location linking
3. Bookmarks appear in AU Archive database
4. No Google services contacted
5. Logins persist for future archiving
