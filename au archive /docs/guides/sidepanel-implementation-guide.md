# Chrome Side Panel Implementation Guide

A step-by-step guide for implementing the AU Archive Side Panel extension feature.

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [File Structure](#file-structure)
4. [Step 1: Update Manifest](#step-1-update-manifest)
5. [Step 2: Create Side Panel HTML](#step-2-create-side-panel-html)
6. [Step 3: Create Side Panel CSS](#step-3-create-side-panel-css)
7. [Step 4: Create Side Panel JavaScript](#step-4-create-side-panel-javascript)
8. [Step 5: Update Background Script](#step-5-update-background-script)
9. [Step 6: Add WebSocket Server](#step-6-add-websocket-server)
10. [Step 7: Add Create Location Endpoint](#step-7-add-create-location-endpoint)
11. [Step 8: Wire Up Main Process](#step-8-wire-up-main-process)
12. [Testing Checklist](#testing-checklist)

---

## Overview

### What We're Building

A persistent side panel that appears when the user clicks the extension icon, providing:

- **Search**: Autocomplete search for locations
- **Recent Locations**: Quick-select from recently used
- **New Location**: Create locations directly from browser
- **Save Bookmark**: Save current page to selected location
- **Real-time Updates**: WebSocket keeps location list fresh
- **Session History**: See what you've saved this session

### Architecture

```
┌─────────────────────┐     HTTP      ┌─────────────────────┐
│   Side Panel        │──────────────▶│   Electron App      │
│   (sidepanel.js)    │               │   (API :47123)      │
│                     │◀──────────────│                     │
│                     │   WebSocket   │   (WS :47124)       │
└─────────────────────┘   (:47124)    └─────────────────────┘
```

---

## Prerequisites

Before starting, ensure you understand:

1. **Chrome Extension Manifest V3** - Service workers, permissions model
2. **Chrome Side Panel API** - `chrome.sidePanel` methods
3. **WebSocket basics** - Connection lifecycle, message handling
4. **The existing codebase**:
   - `resources/extension/` - Current extension files
   - `packages/desktop/electron/services/bookmark-api-server.ts` - HTTP API

---

## File Structure

After implementation, the extension folder will contain:

```
resources/extension/
├── manifest.json        # MODIFY - Add sidePanel permission
├── background.js        # MODIFY - Handle side panel opening
├── sidepanel.html       # NEW - Side panel UI structure
├── sidepanel.css        # NEW - Side panel styles
├── sidepanel.js         # NEW - Side panel logic
├── popup.html           # KEEP - Fallback for older Chrome
├── popup.js             # KEEP - Fallback logic
├── popup.css            # KEEP - Fallback styles
└── icons/               # KEEP - Extension icons
```

Electron services:

```
packages/desktop/electron/services/
├── bookmark-api-server.ts    # MODIFY - Add create location endpoint
└── websocket-server.ts       # NEW - Real-time updates
```

---

## Step 1: Update Manifest

**File:** `resources/extension/manifest.json`

### What to Change

1. Add `sidePanel` permission
2. Add `side_panel` configuration
3. Update version number
4. Add WebSocket host permission

### Code

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
    "sidePanel"
  ],

  "host_permissions": [
    "http://localhost:47123/*"
  ],

  "action": {
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    },
    "default_title": "Open AU Archive Panel"
  },

  "side_panel": {
    "default_path": "sidepanel.html"
  },

  "background": {
    "service_worker": "background.js"
  },

  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

### Key Points

- `"sidePanel"` permission enables the Side Panel API
- `"side_panel"` block specifies the HTML file to load
- We removed `"default_popup"` from action - clicking icon now opens side panel
- Version bumped to 1.1.0

---

## Step 2: Create Side Panel HTML

**File:** `resources/extension/sidepanel.html`

### Structure

The panel has these sections:
1. Header with connection status
2. Search input with autocomplete dropdown
3. Recent locations list
4. New location form (collapsible)
5. Current page info
6. Save button
7. Session history

### Code

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AU Archive</title>
  <link rel="stylesheet" href="sidepanel.css">
</head>
<body>
  <div class="panel">
    <!-- Header -->
    <header class="header">
      <h1>AU Archive</h1>
      <div class="status" id="status">
        <span class="status-dot" id="status-dot"></span>
        <span class="status-text" id="status-text">Connecting...</span>
      </div>
    </header>

    <!-- Search Section -->
    <section class="section">
      <div class="search-container">
        <input
          type="text"
          id="search-input"
          class="search-input"
          placeholder="Search locations..."
          autocomplete="off"
        >
        <div class="search-results" id="search-results"></div>
      </div>
    </section>

    <!-- Recent Locations -->
    <section class="section">
      <h2 class="section-title">Recent Locations</h2>
      <div class="location-list" id="recent-locations">
        <div class="loading">Loading...</div>
      </div>
    </section>

    <!-- New Location Form (Collapsible) -->
    <section class="section">
      <button class="toggle-btn" id="toggle-new-location">
        <span class="toggle-icon">+</span> New Location
      </button>
      <div class="new-location-form" id="new-location-form" hidden>
        <div class="form-group">
          <label for="new-loc-name">Name</label>
          <input type="text" id="new-loc-name" placeholder="Greystone Psychiatric">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label for="new-loc-state">State</label>
            <input type="text" id="new-loc-state" placeholder="NJ" maxlength="2">
          </div>
          <div class="form-group">
            <label for="new-loc-type">Type</label>
            <select id="new-loc-type">
              <option value="">Select...</option>
              <option value="hospital">Hospital</option>
              <option value="asylum">Asylum</option>
              <option value="factory">Factory</option>
              <option value="school">School</option>
              <option value="prison">Prison</option>
              <option value="military">Military</option>
              <option value="residential">Residential</option>
              <option value="commercial">Commercial</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
        <button class="btn btn-secondary" id="create-location-btn">Create Location</button>
      </div>
    </section>

    <!-- Divider -->
    <hr class="divider">

    <!-- Current Page -->
    <section class="section">
      <h2 class="section-title">Current Page</h2>
      <div class="current-page" id="current-page">
        <div class="page-title" id="page-title">Loading...</div>
        <div class="page-url" id="page-url"></div>
      </div>
    </section>

    <!-- Save Section -->
    <section class="section save-section">
      <div class="selected-location" id="selected-location">
        <span class="selected-label">Save to:</span>
        <span class="selected-name" id="selected-name">Select a location</span>
        <button class="clear-btn" id="clear-selection" hidden>&times;</button>
      </div>
      <button class="btn btn-primary" id="save-btn" disabled>
        <span class="btn-text">Save Bookmark</span>
        <span class="btn-loading" hidden>Saving...</span>
      </button>
    </section>

    <!-- Session History -->
    <section class="section">
      <h2 class="section-title">Session History</h2>
      <div class="history-list" id="session-history">
        <div class="history-empty">No bookmarks saved this session</div>
      </div>
    </section>

    <!-- Error Toast -->
    <div class="toast" id="toast" hidden>
      <span class="toast-message" id="toast-message"></span>
    </div>
  </div>

  <script src="sidepanel.js"></script>
</body>
</html>
```

### Key Points

- Semantic sections for each feature area
- IDs on all interactive elements for JS binding
- Hidden states managed via `hidden` attribute
- Toast element for notifications

---

## Step 3: Create Side Panel CSS

**File:** `resources/extension/sidepanel.css`

### Design Principles

- Dark theme matching Electron app
- 300px fixed width (Chrome side panel default)
- Clear visual hierarchy
- Accessible color contrast

### Code

```css
/* Reset and Base */
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  line-height: 1.4;
  background: #1a1a1a;
  color: #e0e0e0;
  width: 100%;
  min-height: 100vh;
}

/* Panel Container */
.panel {
  display: flex;
  flex-direction: column;
  padding: 12px;
  gap: 12px;
}

/* Header */
.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 8px;
  border-bottom: 1px solid #333;
}

.header h1 {
  font-size: 16px;
  font-weight: 600;
  color: #fff;
}

.status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #666;
}

.status-dot.online { background: #4caf50; }
.status-dot.connecting { background: #ff9800; }
.status-dot.offline { background: #f44336; }

.status-text {
  color: #888;
}

/* Sections */
.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #888;
}

/* Search */
.search-container {
  position: relative;
}

.search-input {
  width: 100%;
  padding: 10px 12px;
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 6px;
  color: #fff;
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s;
}

.search-input:focus {
  border-color: #6366f1;
}

.search-input::placeholder {
  color: #666;
}

.search-results {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: #2a2a2a;
  border: 1px solid #444;
  border-radius: 6px;
  margin-top: 4px;
  max-height: 200px;
  overflow-y: auto;
  z-index: 100;
  display: none;
}

.search-results.show {
  display: block;
}

.search-result-item {
  padding: 10px 12px;
  cursor: pointer;
  border-bottom: 1px solid #333;
  transition: background 0.15s;
}

.search-result-item:last-child {
  border-bottom: none;
}

.search-result-item:hover {
  background: #333;
}

.search-result-item .name {
  font-weight: 500;
  color: #fff;
}

.search-result-item .state {
  font-size: 11px;
  color: #888;
  margin-left: 6px;
}

/* Location List */
.location-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.location-item {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  background: #2a2a2a;
  border: 1px solid #333;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;
}

.location-item:hover {
  background: #333;
  border-color: #444;
}

.location-item.selected {
  background: #3730a3;
  border-color: #6366f1;
}

.location-item .icon {
  margin-right: 8px;
  font-size: 14px;
}

.location-item .name {
  flex: 1;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.location-item .state {
  font-size: 11px;
  color: #888;
  margin-left: 8px;
}

.loading, .history-empty {
  text-align: center;
  color: #666;
  padding: 16px;
  font-style: italic;
}

/* New Location Form */
.toggle-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: transparent;
  border: 1px dashed #444;
  border-radius: 6px;
  color: #888;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s;
}

.toggle-btn:hover {
  border-color: #666;
  color: #fff;
}

.toggle-btn.active {
  border-style: solid;
  border-color: #6366f1;
  color: #fff;
}

.toggle-icon {
  font-size: 16px;
  font-weight: 300;
}

.new-location-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: #2a2a2a;
  border-radius: 6px;
  margin-top: 8px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-group label {
  font-size: 11px;
  font-weight: 500;
  color: #888;
}

.form-group input,
.form-group select {
  padding: 8px 10px;
  background: #1a1a1a;
  border: 1px solid #444;
  border-radius: 4px;
  color: #fff;
  font-size: 13px;
  outline: none;
}

.form-group input:focus,
.form-group select:focus {
  border-color: #6366f1;
}

.form-row {
  display: flex;
  gap: 10px;
}

.form-row .form-group {
  flex: 1;
}

/* Buttons */
.btn {
  padding: 10px 16px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: #6366f1;
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  background: #4f46e5;
}

.btn-secondary {
  background: #333;
  color: #fff;
}

.btn-secondary:hover:not(:disabled) {
  background: #444;
}

.btn-loading {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

/* Divider */
.divider {
  border: none;
  border-top: 1px solid #333;
  margin: 4px 0;
}

/* Current Page */
.current-page {
  padding: 10px 12px;
  background: #2a2a2a;
  border-radius: 6px;
}

.page-title {
  font-weight: 500;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
}

.page-url {
  font-size: 11px;
  color: #666;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Save Section */
.save-section {
  padding: 12px;
  background: #222;
  border-radius: 8px;
  margin-top: 4px;
}

.selected-location {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.selected-label {
  font-size: 11px;
  color: #888;
}

.selected-name {
  flex: 1;
  font-weight: 500;
  color: #fff;
}

.selected-name.placeholder {
  color: #666;
  font-style: italic;
}

.clear-btn {
  padding: 2px 6px;
  background: #333;
  border: none;
  border-radius: 4px;
  color: #888;
  cursor: pointer;
  font-size: 14px;
}

.clear-btn:hover {
  background: #444;
  color: #fff;
}

/* History */
.history-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 150px;
  overflow-y: auto;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: #2a2a2a;
  border-radius: 4px;
  font-size: 12px;
}

.history-item .url {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #888;
}

.history-item .loc {
  font-weight: 500;
  color: #6366f1;
  white-space: nowrap;
}

/* Toast */
.toast {
  position: fixed;
  bottom: 16px;
  left: 12px;
  right: 12px;
  padding: 12px 16px;
  background: #333;
  border-radius: 6px;
  color: #fff;
  font-size: 13px;
  z-index: 1000;
  animation: slideUp 0.2s ease;
}

.toast.success {
  background: #166534;
}

.toast.error {
  background: #991b1b;
}

@keyframes slideUp {
  from {
    transform: translateY(20px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

/* Scrollbar */
::-webkit-scrollbar {
  width: 6px;
}

::-webkit-scrollbar-track {
  background: #1a1a1a;
}

::-webkit-scrollbar-thumb {
  background: #444;
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: #555;
}
```

---

## Step 4: Create Side Panel JavaScript

**File:** `resources/extension/sidepanel.js`

### Responsibilities

1. Connect to HTTP API and WebSocket
2. Handle search with debounce
3. Manage location selection state
4. Save bookmarks
5. Create new locations
6. Track session history
7. Handle real-time updates

### Code

```javascript
/**
 * sidepanel.js
 *
 * AU Archive Side Panel - Main logic
 */

const API_BASE = 'http://localhost:47123';
const WS_URL = 'ws://localhost:47124';

// State
let selectedLocation = null;
let currentTab = null;
let sessionHistory = [];
let ws = null;
let wsReconnectTimeout = null;
let searchTimeout = null;

// DOM Elements
const elements = {};

/**
 * Initialize the side panel
 */
async function init() {
  // Cache DOM elements
  cacheElements();

  // Set up event listeners
  setupEventListeners();

  // Check API status
  const online = await checkApiStatus();
  updateConnectionStatus(online ? 'online' : 'offline');

  if (online) {
    // Connect WebSocket
    connectWebSocket();

    // Load initial data
    await loadRecentLocations();
    await loadCurrentTab();
  }
}

/**
 * Cache DOM element references
 */
function cacheElements() {
  elements.statusDot = document.getElementById('status-dot');
  elements.statusText = document.getElementById('status-text');
  elements.searchInput = document.getElementById('search-input');
  elements.searchResults = document.getElementById('search-results');
  elements.recentLocations = document.getElementById('recent-locations');
  elements.toggleNewLocation = document.getElementById('toggle-new-location');
  elements.newLocationForm = document.getElementById('new-location-form');
  elements.newLocName = document.getElementById('new-loc-name');
  elements.newLocState = document.getElementById('new-loc-state');
  elements.newLocType = document.getElementById('new-loc-type');
  elements.createLocationBtn = document.getElementById('create-location-btn');
  elements.pageTitle = document.getElementById('page-title');
  elements.pageUrl = document.getElementById('page-url');
  elements.selectedName = document.getElementById('selected-name');
  elements.clearSelection = document.getElementById('clear-selection');
  elements.saveBtn = document.getElementById('save-btn');
  elements.sessionHistory = document.getElementById('session-history');
  elements.toast = document.getElementById('toast');
  elements.toastMessage = document.getElementById('toast-message');
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
  // Search
  elements.searchInput.addEventListener('input', handleSearchInput);
  elements.searchInput.addEventListener('keydown', handleSearchKeydown);

  // Close search results when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container')) {
      elements.searchResults.classList.remove('show');
    }
  });

  // New location toggle
  elements.toggleNewLocation.addEventListener('click', toggleNewLocationForm);

  // Create location
  elements.createLocationBtn.addEventListener('click', handleCreateLocation);

  // Clear selection
  elements.clearSelection.addEventListener('click', clearSelection);

  // Save bookmark
  elements.saveBtn.addEventListener('click', handleSaveBookmark);

  // Enter key to save
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
      handleSaveBookmark();
    }
  });
}

/**
 * Check if API is running
 */
async function checkApiStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/status`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Update connection status UI
 */
function updateConnectionStatus(status) {
  elements.statusDot.className = 'status-dot ' + status;

  const messages = {
    online: 'Connected',
    connecting: 'Connecting...',
    offline: 'Offline'
  };

  elements.statusText.textContent = messages[status] || status;
}

/**
 * Connect to WebSocket for real-time updates
 */
function connectWebSocket() {
  if (ws) {
    ws.close();
  }

  updateConnectionStatus('connecting');

  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('WebSocket connected');
      updateConnectionStatus('online');

      // Subscribe to updates
      ws.send(JSON.stringify({ type: 'subscribe' }));

      // Clear reconnect timeout
      if (wsReconnectTimeout) {
        clearTimeout(wsReconnectTimeout);
        wsReconnectTimeout = null;
      }
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleWebSocketMessage(message);
      } catch (err) {
        console.error('Invalid WebSocket message:', err);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      updateConnectionStatus('offline');
      scheduleReconnect();
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };
  } catch (err) {
    console.error('WebSocket connection failed:', err);
    updateConnectionStatus('offline');
    scheduleReconnect();
  }
}

/**
 * Schedule WebSocket reconnection with backoff
 */
function scheduleReconnect() {
  if (wsReconnectTimeout) return;

  wsReconnectTimeout = setTimeout(() => {
    wsReconnectTimeout = null;
    connectWebSocket();
  }, 5000);
}

/**
 * Handle incoming WebSocket messages
 */
function handleWebSocketMessage(message) {
  switch (message.type) {
    case 'locations_updated':
      // Refresh location list
      loadRecentLocations();
      break;

    case 'bookmark_saved':
      // Could show confirmation
      break;

    case 'ping':
      // Respond to heartbeat
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
      break;
  }
}

/**
 * Load recent locations from API
 */
async function loadRecentLocations() {
  try {
    const res = await fetch(`${API_BASE}/api/recent-locations?limit=5`);
    const data = await res.json();

    if (data.locations && data.locations.length > 0) {
      renderLocationList(data.locations);
    } else {
      elements.recentLocations.innerHTML =
        '<div class="loading">No locations yet. Create one below!</div>';
    }
  } catch (err) {
    console.error('Failed to load locations:', err);
    elements.recentLocations.innerHTML =
      '<div class="loading">Failed to load locations</div>';
  }
}

/**
 * Render location list
 */
function renderLocationList(locations) {
  elements.recentLocations.innerHTML = locations.map(loc => `
    <div class="location-item ${selectedLocation?.locid === loc.locid ? 'selected' : ''}"
         data-locid="${loc.locid}"
         data-name="${escapeHtml(loc.locnam)}">
      <span class="icon">📍</span>
      <span class="name">${escapeHtml(loc.locnam)}</span>
      ${loc.address_state ? `<span class="state">${escapeHtml(loc.address_state)}</span>` : ''}
    </div>
  `).join('');

  // Add click handlers
  elements.recentLocations.querySelectorAll('.location-item').forEach(item => {
    item.addEventListener('click', () => selectLocation({
      locid: item.dataset.locid,
      locnam: item.dataset.name
    }));
  });
}

/**
 * Handle search input
 */
function handleSearchInput(e) {
  const query = e.target.value.trim();

  // Clear previous timeout
  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }

  if (!query) {
    elements.searchResults.classList.remove('show');
    return;
  }

  // Debounce search
  searchTimeout = setTimeout(() => searchLocations(query), 300);
}

/**
 * Handle search keyboard navigation
 */
function handleSearchKeydown(e) {
  if (e.key === 'Escape') {
    elements.searchResults.classList.remove('show');
    elements.searchInput.blur();
  }
}

/**
 * Search locations via API
 */
async function searchLocations(query) {
  try {
    const res = await fetch(`${API_BASE}/api/locations?search=${encodeURIComponent(query)}`);
    const data = await res.json();

    if (data.locations && data.locations.length > 0) {
      renderSearchResults(data.locations);
      elements.searchResults.classList.add('show');
    } else {
      elements.searchResults.innerHTML =
        '<div class="search-result-item"><span class="name">No matches</span></div>';
      elements.searchResults.classList.add('show');
    }
  } catch (err) {
    console.error('Search failed:', err);
  }
}

/**
 * Render search results
 */
function renderSearchResults(locations) {
  elements.searchResults.innerHTML = locations.map(loc => `
    <div class="search-result-item"
         data-locid="${loc.locid}"
         data-name="${escapeHtml(loc.locnam)}">
      <span class="name">${escapeHtml(loc.locnam)}</span>
      ${loc.address_state ? `<span class="state">${escapeHtml(loc.address_state)}</span>` : ''}
    </div>
  `).join('');

  // Add click handlers
  elements.searchResults.querySelectorAll('.search-result-item').forEach(item => {
    item.addEventListener('click', () => {
      selectLocation({
        locid: item.dataset.locid,
        locnam: item.dataset.name
      });
      elements.searchInput.value = '';
      elements.searchResults.classList.remove('show');
    });
  });
}

/**
 * Select a location
 */
function selectLocation(location) {
  selectedLocation = location;

  // Update UI
  elements.selectedName.textContent = location.locnam;
  elements.selectedName.classList.remove('placeholder');
  elements.clearSelection.hidden = false;
  elements.saveBtn.disabled = false;

  // Update location list selection
  elements.recentLocations.querySelectorAll('.location-item').forEach(item => {
    item.classList.toggle('selected', item.dataset.locid === location.locid);
  });
}

/**
 * Clear location selection
 */
function clearSelection() {
  selectedLocation = null;

  elements.selectedName.textContent = 'Select a location';
  elements.selectedName.classList.add('placeholder');
  elements.clearSelection.hidden = true;
  elements.saveBtn.disabled = true;

  // Clear selection in list
  elements.recentLocations.querySelectorAll('.location-item').forEach(item => {
    item.classList.remove('selected');
  });
}

/**
 * Toggle new location form
 */
function toggleNewLocationForm() {
  const form = elements.newLocationForm;
  const btn = elements.toggleNewLocation;

  if (form.hidden) {
    form.hidden = false;
    btn.classList.add('active');
    elements.newLocName.focus();
  } else {
    form.hidden = true;
    btn.classList.remove('active');
  }
}

/**
 * Handle create location
 */
async function handleCreateLocation() {
  const name = elements.newLocName.value.trim();
  const state = elements.newLocState.value.trim().toUpperCase();
  const type = elements.newLocType.value;

  if (!name) {
    showToast('Please enter a location name', 'error');
    return;
  }

  elements.createLocationBtn.disabled = true;
  elements.createLocationBtn.textContent = 'Creating...';

  try {
    const res = await fetch(`${API_BASE}/api/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, state, type })
    });

    const data = await res.json();

    if (data.success) {
      showToast(`Created "${data.locnam}"`, 'success');

      // Select the new location
      selectLocation({
        locid: data.locid,
        locnam: data.locnam
      });

      // Clear form and close
      elements.newLocName.value = '';
      elements.newLocState.value = '';
      elements.newLocType.value = '';
      elements.newLocationForm.hidden = true;
      elements.toggleNewLocation.classList.remove('active');

      // Refresh location list
      await loadRecentLocations();
    } else {
      showToast(data.error || 'Failed to create location', 'error');
    }
  } catch (err) {
    console.error('Create location failed:', err);
    showToast('Failed to create location', 'error');
  } finally {
    elements.createLocationBtn.disabled = false;
    elements.createLocationBtn.textContent = 'Create Location';
  }
}

/**
 * Load current tab info
 */
async function loadCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab) {
      currentTab = tab;
      elements.pageTitle.textContent = tab.title || 'Untitled';
      elements.pageUrl.textContent = tab.url || '';
    }
  } catch (err) {
    console.error('Failed to get current tab:', err);
  }
}

/**
 * Handle save bookmark
 */
async function handleSaveBookmark() {
  if (!currentTab) {
    showToast('No page to save', 'error');
    return;
  }

  const saveBtn = elements.saveBtn;
  const btnText = saveBtn.querySelector('.btn-text');
  const btnLoading = saveBtn.querySelector('.btn-loading');

  saveBtn.disabled = true;
  btnText.hidden = true;
  btnLoading.hidden = false;

  try {
    const res = await fetch(`${API_BASE}/api/bookmark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: currentTab.url,
        title: currentTab.title,
        locid: selectedLocation?.locid || null
      })
    });

    const data = await res.json();

    if (data.success) {
      const locName = selectedLocation?.locnam || 'Inbox';
      showToast(`Saved to ${locName}`, 'success');

      // Add to session history
      addToSessionHistory(currentTab.url, locName);

      // Clear selection for next save
      // clearSelection();
    } else {
      showToast(data.error || 'Failed to save bookmark', 'error');
    }
  } catch (err) {
    console.error('Save bookmark failed:', err);
    showToast('Failed to save bookmark', 'error');
  } finally {
    saveBtn.disabled = !selectedLocation;
    btnText.hidden = false;
    btnLoading.hidden = true;
  }
}

/**
 * Add bookmark to session history
 */
function addToSessionHistory(url, locationName) {
  // Add to beginning
  sessionHistory.unshift({ url, locationName, timestamp: Date.now() });

  // Keep only last 10
  sessionHistory = sessionHistory.slice(0, 10);

  renderSessionHistory();
}

/**
 * Render session history
 */
function renderSessionHistory() {
  if (sessionHistory.length === 0) {
    elements.sessionHistory.innerHTML =
      '<div class="history-empty">No bookmarks saved this session</div>';
    return;
  }

  elements.sessionHistory.innerHTML = sessionHistory.map(item => {
    const displayUrl = new URL(item.url).hostname;
    return `
      <div class="history-item">
        <span class="url">${escapeHtml(displayUrl)}</span>
        <span class="loc">${escapeHtml(item.locationName)}</span>
      </div>
    `;
  }).join('');
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info') {
  elements.toastMessage.textContent = message;
  elements.toast.className = `toast ${type}`;
  elements.toast.hidden = false;

  setTimeout(() => {
    elements.toast.hidden = true;
  }, 3000);
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Listen for tab changes to update current page
chrome.tabs.onActivated.addListener(loadCurrentTab);
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (currentTab && tabId === currentTab.id && changeInfo.status === 'complete') {
    loadCurrentTab();
  }
});

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
```

---

## Step 5: Update Background Script

**File:** `resources/extension/background.js`

### Changes Needed

1. Remove popup opening logic
2. Add side panel opening on action click
3. Keep context menu functionality

### Code Changes

Add this to the existing background.js at the top, after constants:

```javascript
/**
 * Open side panel when extension icon is clicked
 */
chrome.action.onClicked.addListener(async (tab) => {
  // Open the side panel for this tab
  await chrome.sidePanel.open({ tabId: tab.id });

  // Also refresh locations
  await fetchRecentLocations();
  await buildContextMenu();
});

/**
 * Set side panel behavior
 */
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
```

Remove the existing `chrome.action.onClicked` listener that was refreshing menu (line ~228).

---

## Step 6: Add WebSocket Server

**File:** `packages/desktop/electron/services/websocket-server.ts`

### Purpose

Provides real-time updates to the extension:
- Broadcasts when locations change
- Broadcasts when bookmarks are saved
- Handles client connections with heartbeat

### Code

```typescript
/**
 * websocket-server.ts
 *
 * WebSocket server for real-time extension communication.
 * Runs on localhost:47124 alongside the HTTP API.
 */
import { WebSocketServer, WebSocket } from 'ws';
import { getLogger } from './logger-service';

const WS_PORT = 47124;
const HEARTBEAT_INTERVAL = 30000;

const logger = getLogger();

let wss: WebSocketServer | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;

/**
 * Connected clients
 */
const clients = new Set<WebSocket>();

/**
 * Start the WebSocket server
 */
export function startWebSocketServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      wss = new WebSocketServer({
        port: WS_PORT,
        host: '127.0.0.1'
      });

      wss.on('connection', (ws) => {
        logger.info('WebSocketServer', 'Client connected');
        clients.add(ws);

        ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            handleClientMessage(ws, message);
          } catch (err) {
            logger.error('WebSocketServer', `Invalid message: ${err}`);
          }
        });

        ws.on('close', () => {
          logger.info('WebSocketServer', 'Client disconnected');
          clients.delete(ws);
        });

        ws.on('error', (err) => {
          logger.error('WebSocketServer', `Client error: ${err}`);
          clients.delete(ws);
        });
      });

      wss.on('listening', () => {
        logger.info('WebSocketServer', `Running on ws://localhost:${WS_PORT}`);
        startHeartbeat();
        resolve();
      });

      wss.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          logger.error('WebSocketServer', `Port ${WS_PORT} is already in use`);
          reject(new Error(`Port ${WS_PORT} is already in use`));
        } else {
          reject(err);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Stop the WebSocket server
 */
export function stopWebSocketServer(): Promise<void> {
  return new Promise((resolve) => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }

    if (wss) {
      // Close all client connections
      clients.forEach((client) => {
        client.close();
      });
      clients.clear();

      wss.close(() => {
        logger.info('WebSocketServer', 'Server stopped');
        wss = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

/**
 * Handle incoming client messages
 */
function handleClientMessage(ws: WebSocket, message: { type: string }) {
  switch (message.type) {
    case 'subscribe':
      logger.info('WebSocketServer', 'Client subscribed');
      break;

    case 'pong':
      // Client responded to heartbeat
      break;

    default:
      logger.warn('WebSocketServer', `Unknown message type: ${message.type}`);
  }
}

/**
 * Start heartbeat to keep connections alive
 */
function startHeartbeat() {
  heartbeatInterval = setInterval(() => {
    broadcast({ type: 'ping' });
  }, HEARTBEAT_INTERVAL);
}

/**
 * Broadcast message to all connected clients
 */
export function broadcast(message: object): void {
  const data = JSON.stringify(message);

  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

/**
 * Notify clients that locations were updated
 */
export function notifyLocationsUpdated(): void {
  broadcast({ type: 'locations_updated' });
}

/**
 * Notify clients that a bookmark was saved
 */
export function notifyBookmarkSaved(bookmarkId: string, locid: string | null): void {
  broadcast({
    type: 'bookmark_saved',
    bookmark_id: bookmarkId,
    locid
  });
}

/**
 * Check if server is running
 */
export function isWebSocketServerRunning(): boolean {
  return wss !== null;
}
```

---

## Step 7: Add Create Location Endpoint

**File:** `packages/desktop/electron/services/bookmark-api-server.ts`

### Changes

Add a new endpoint `POST /api/location` to create locations from the extension.

### Code to Add

Add this handler inside the `handleRequest` function, after the existing endpoints:

```typescript
// POST /api/location - Create a new location
if (method === 'POST' && path === '/api/location') {
  if (!locationsRepository) {
    sendJson(res, 500, { error: 'Locations repository not initialized' });
    return;
  }

  const body = await parseBody(req);

  if (!body.name || typeof body.name !== 'string') {
    sendJson(res, 400, { error: 'Location name is required' });
    return;
  }

  try {
    const location = await locationsRepository.create({
      locnam: body.name,
      address: {
        state: typeof body.state === 'string' ? body.state.toUpperCase() : null,
        city: null,
        street: null,
        zip: null,
      },
      loctyp: typeof body.type === 'string' ? body.type : null,
    });

    // Notify WebSocket clients
    const { notifyLocationsUpdated } = await import('./websocket-server');
    notifyLocationsUpdated();

    sendJson(res, 201, {
      success: true,
      locid: location.locid,
      locnam: location.locnam,
    });
  } catch (error) {
    logger.error('BookmarkAPI', `Create location error: ${error}`);
    sendJson(res, 500, { error: 'Failed to create location' });
  }
  return;
}
```

Also update the bookmark creation to notify WebSocket clients:

```typescript
// In the POST /api/bookmark handler, after successful creation:
const { notifyBookmarkSaved } = await import('./websocket-server');
notifyBookmarkSaved(bookmark.bookmark_id, bookmark.locid);
```

---

## Step 8: Wire Up Main Process

**File:** `packages/desktop/electron/main/index.ts` (or wherever app initializes)

### Changes

1. Import and start WebSocket server
2. Start it after HTTP server

### Code to Add

```typescript
import { startWebSocketServer, stopWebSocketServer } from '../services/websocket-server';

// In app initialization, after startBookmarkAPIServer:
await startWebSocketServer();

// In app cleanup/quit:
await stopWebSocketServer();
```

---

## Testing Checklist

### Setup Tests
- [ ] Extension loads without errors
- [ ] Manifest valid (no Chrome warnings)
- [ ] Side panel opens on icon click
- [ ] HTTP API responds (localhost:47123)
- [ ] WebSocket connects (localhost:47124)

### Functionality Tests
- [ ] Search returns matching locations
- [ ] Search autocomplete shows/hides correctly
- [ ] Clicking location selects it
- [ ] Selected location enables save button
- [ ] Clear selection works
- [ ] Create location form toggles
- [ ] Create location saves and selects new location
- [ ] Save bookmark works with location
- [ ] Save bookmark works without location (inbox)
- [ ] Session history updates after save
- [ ] Current page info updates on tab change
- [ ] Toast notifications appear and dismiss

### Real-time Tests
- [ ] WebSocket reconnects after disconnect
- [ ] Creating location in app updates panel list
- [ ] Connection status indicator accurate

### Edge Cases
- [ ] App not running shows offline state
- [ ] Long location names truncate properly
- [ ] Special characters in names handled (XSS prevention)
- [ ] Empty search clears results
- [ ] Escape key closes search results

### Keyboard Tests
- [ ] Ctrl+Enter saves bookmark
- [ ] Tab navigation works through form
- [ ] Escape closes search dropdown

---

## Troubleshooting

### Side Panel Not Opening
- Check `sidePanel` permission in manifest
- Verify `side_panel` block with correct path
- Check Chrome version (114+ required)

### WebSocket Not Connecting
- Verify server is running on port 47124
- Check for port conflicts
- Look for CORS issues in console

### Search Not Working
- Verify API server running on 47123
- Check network tab for request/response
- Look for CORS headers in response

### Styles Not Loading
- Verify CSS file path in HTML
- Check for CSS syntax errors
- Hard refresh extension (remove and re-add)

---

## Summary

This guide covers implementing a Chrome Side Panel for the AU Archive extension with:

1. **Persistent UI** - Always-visible panel while browsing
2. **Search** - Autocomplete location search
3. **Quick Select** - Recent locations list
4. **Create** - New location form inline
5. **Save** - Bookmark current page
6. **Real-time** - WebSocket updates
7. **History** - Session bookmark tracking

Total new/modified files: **9**
Estimated lines of code: **~800**
