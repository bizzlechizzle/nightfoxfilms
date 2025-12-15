# Research Browser Implementation Guide

A step-by-step guide for implementing the Research Browser feature. Written for developers who may be less experienced with Electron, Puppeteer, or browser extensions.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Overview](#overview)
3. [Step 1: Add Dependencies](#step-1-add-dependencies)
4. [Step 2: Create Bookmark API Server](#step-2-create-bookmark-api-server)
5. [Step 3: Create Research Browser Service](#step-3-create-research-browser-service)
6. [Step 4: Create IPC Handlers](#step-4-create-ipc-handlers)
7. [Step 5: Update Preload Bridge](#step-5-update-preload-bridge)
8. [Step 6: Create Browser Extension](#step-6-create-browser-extension)
9. [Step 7: Update Navigation](#step-7-update-navigation)
10. [Step 8: Initialize Services](#step-8-initialize-services)
11. [Step 9: Bundle Ungoogled Chromium](#step-9-bundle-ungoogled-chromium)
12. [Step 10: Cleanup Old Code](#step-10-cleanup-old-code)
13. [Testing](#testing)
14. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before starting, ensure you understand:
- Basic TypeScript/JavaScript
- How Electron's main/renderer/preload processes work
- What IPC (Inter-Process Communication) is
- Basic HTTP server concepts

---

## Overview

We're building:
1. **Bookmark API Server** - HTTP server that browser extension talks to
2. **Research Browser Service** - Launches Ungoogled Chromium via Puppeteer
3. **Browser Extension** - UI inside browser for saving bookmarks
4. **Navigation Update** - "Research" button that launches the browser

---

## Step 1: Add Dependencies

### 1.1 Install puppeteer-core

```bash
cd packages/desktop
pnpm add puppeteer-core
```

**Why puppeteer-core?** Unlike `puppeteer`, it doesn't download Chromium automatically. We provide our own Ungoogled Chromium.

### 1.2 Add TypeScript types

```bash
pnpm add -D @types/puppeteer-core
```

---

## Step 2: Create Bookmark API Server

Create a new file: `packages/desktop/electron/services/bookmark-api-server.ts`

### 2.1 Understanding the Purpose

The browser extension needs to communicate with our Electron app. Since the extension runs in a separate browser process, we use HTTP:

```
Extension (in Ungoogled Chromium)
    → HTTP POST to localhost:47123/api/bookmark
    → Electron app receives and saves to database
```

### 2.2 Implementation

```typescript
/**
 * bookmark-api-server.ts
 *
 * HTTP server that receives bookmark data from the browser extension.
 * Runs on localhost:47123 - only accepts local connections for security.
 */
import http from 'http';
import { URL } from 'url';
import { getLogger } from './logger';

// We'll inject these dependencies when initializing
let bookmarksRepository: any;
let locationsRepository: any;

const PORT = 47123;
const logger = getLogger();

/**
 * Parse JSON body from incoming request
 */
function parseBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response
 */
function sendJson(res: http.ServerResponse, status: number, data: any) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*', // Allow extension to call us
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(data));
}

/**
 * Handle incoming HTTP requests
 */
async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method || 'GET';

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    sendJson(res, 200, {});
    return;
  }

  logger.info('BookmarkAPI', `${method} ${path}`);

  try {
    // GET /api/status - Check if app is running
    if (method === 'GET' && path === '/api/status') {
      sendJson(res, 200, { running: true, version: '1.0.0' });
      return;
    }

    // POST /api/bookmark - Save a bookmark
    if (method === 'POST' && path === '/api/bookmark') {
      const body = await parseBody(req);

      if (!body.url) {
        sendJson(res, 400, { error: 'URL is required' });
        return;
      }

      const bookmark = await bookmarksRepository.create({
        url: body.url,
        title: body.title || null,
        locid: body.locid || null,
        auth_imp: null,
      });

      sendJson(res, 201, { success: true, bookmark_id: bookmark.bookmark_id });
      return;
    }

    // GET /api/locations?search=query - Search locations for autocomplete
    if (method === 'GET' && path === '/api/locations') {
      const search = url.searchParams.get('search') || '';
      const locations = await locationsRepository.findAll({ search, limit: 10 });

      sendJson(res, 200, {
        locations: locations.map((loc: any) => ({
          locid: loc.locid,
          locnam: loc.locnam,
          address_state: loc.address?.state || loc.address_state,
        })),
      });
      return;
    }

    // GET /api/recent?limit=5 - Get recent bookmarks
    if (method === 'GET' && path === '/api/recent') {
      const limit = parseInt(url.searchParams.get('limit') || '5', 10);
      const bookmarks = await bookmarksRepository.findRecent(limit);

      sendJson(res, 200, { bookmarks });
      return;
    }

    // 404 for unknown routes
    sendJson(res, 404, { error: 'Not found' });

  } catch (error) {
    logger.error('BookmarkAPI', `Error: ${error}`);
    sendJson(res, 500, { error: 'Internal server error' });
  }
}

let server: http.Server | null = null;

/**
 * Start the HTTP server
 */
export function startBookmarkAPIServer(
  bookmarksRepo: any,
  locationsRepo: any
): Promise<void> {
  return new Promise((resolve, reject) => {
    bookmarksRepository = bookmarksRepo;
    locationsRepository = locationsRepo;

    server = http.createServer(handleRequest);

    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        logger.error('BookmarkAPI', `Port ${PORT} is already in use`);
        reject(new Error(`Port ${PORT} is already in use`));
      } else {
        reject(err);
      }
    });

    server.listen(PORT, '127.0.0.1', () => {
      logger.info('BookmarkAPI', `Server running on http://localhost:${PORT}`);
      resolve();
    });
  });
}

/**
 * Stop the HTTP server
 */
export function stopBookmarkAPIServer(): Promise<void> {
  return new Promise((resolve) => {
    if (server) {
      server.close(() => {
        logger.info('BookmarkAPI', 'Server stopped');
        server = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}
```

### 2.3 Key Concepts Explained

**Why localhost:47123?**
- High port number unlikely to conflict
- Localhost-only means only local processes can connect
- Extension can make HTTP requests to any localhost port

**CORS Headers:**
- Browser extensions need CORS headers to make cross-origin requests
- We allow all origins (`*`) since we only accept localhost connections anyway

---

## Step 3: Create Research Browser Service

Create: `packages/desktop/electron/services/research-browser-service.ts`

### 3.1 Understanding Puppeteer

Puppeteer is a Node.js library that controls a browser. We use `puppeteer-core` which lets us point to our own browser (Ungoogled Chromium) instead of downloading Chrome.

### 3.2 Implementation

```typescript
/**
 * research-browser-service.ts
 *
 * Manages the Ungoogled Chromium browser for research workflows.
 * Uses puppeteer-core to launch and control the browser.
 */
import puppeteer, { Browser } from 'puppeteer-core';
import path from 'path';
import { app } from 'electron';
import { getLogger } from './logger';

const logger = getLogger();

let browser: Browser | null = null;
let isLaunching = false;

/**
 * Get the path to the Ungoogled Chromium executable
 * based on the current platform
 */
function getChromiumPath(): string {
  const platform = process.platform;
  const arch = process.arch;

  // In development, look in resources/browsers/
  // In production, look in app.getPath('exe')/../resources/browsers/
  const isDev = !app.isPackaged;

  let basePath: string;
  if (isDev) {
    basePath = path.join(__dirname, '../../../../resources/browsers/ungoogled-chromium');
  } else {
    basePath = path.join(process.resourcesPath, 'browsers/ungoogled-chromium');
  }

  switch (platform) {
    case 'darwin':
      // macOS - both arm64 and x64 use .app bundle
      const macArch = arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
      return path.join(basePath, macArch, 'Chromium.app/Contents/MacOS/Chromium');

    case 'win32':
      return path.join(basePath, 'win-x64', 'chrome.exe');

    case 'linux':
      return path.join(basePath, 'linux-x64', 'chrome');

    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

/**
 * Get the path to store browser profile data
 * This persists logins, cookies, etc.
 */
function getProfilePath(): string {
  return path.join(app.getPath('userData'), 'research-browser');
}

/**
 * Get the path to our browser extension
 */
function getExtensionPath(): string {
  const isDev = !app.isPackaged;

  if (isDev) {
    return path.join(__dirname, '../../../../resources/extension');
  } else {
    return path.join(process.resourcesPath, 'extension');
  }
}

/**
 * Launch the Research Browser
 */
export async function launchResearchBrowser(): Promise<{ success: boolean; error?: string }> {
  // Prevent multiple simultaneous launches
  if (isLaunching) {
    return { success: false, error: 'Browser is already launching' };
  }

  // If already running, just focus it
  if (browser && browser.connected) {
    logger.info('ResearchBrowser', 'Browser already running');
    return { success: true };
  }

  isLaunching = true;

  try {
    const chromiumPath = getChromiumPath();
    const profilePath = getProfilePath();
    const extensionPath = getExtensionPath();

    logger.info('ResearchBrowser', `Launching browser from: ${chromiumPath}`);
    logger.info('ResearchBrowser', `Profile path: ${profilePath}`);
    logger.info('ResearchBrowser', `Extension path: ${extensionPath}`);

    browser = await puppeteer.launch({
      executablePath: chromiumPath,
      headless: false, // We want a visible browser window
      userDataDir: profilePath, // Persist profile data
      args: [
        `--load-extension=${extensionPath}`,
        '--disable-features=MediaRouter', // Remove Cast button
        '--no-first-run', // Skip first-run wizard
        '--no-default-browser-check', // Don't ask to be default browser
      ],
      ignoreDefaultArgs: [
        '--disable-extensions', // We need extensions enabled
        '--enable-automation', // Hide "Chrome is being controlled" banner
      ],
      defaultViewport: null, // Use full window size
    });

    // Handle browser close
    browser.on('disconnected', () => {
      logger.info('ResearchBrowser', 'Browser disconnected');
      browser = null;
    });

    // Open a default page
    const pages = await browser.pages();
    if (pages.length > 0) {
      await pages[0].goto('https://duckduckgo.com');
    }

    logger.info('ResearchBrowser', 'Browser launched successfully');
    return { success: true };

  } catch (error) {
    logger.error('ResearchBrowser', `Launch failed: ${error}`);
    return { success: false, error: String(error) };
  } finally {
    isLaunching = false;
  }
}

/**
 * Close the Research Browser
 */
export async function closeResearchBrowser(): Promise<void> {
  if (browser) {
    try {
      await browser.close();
    } catch (error) {
      logger.error('ResearchBrowser', `Close error: ${error}`);
    }
    browser = null;
  }
}

/**
 * Check if browser is currently running
 */
export function isResearchBrowserRunning(): boolean {
  return browser !== null && browser.connected;
}

/**
 * Get browser status
 */
export function getResearchBrowserStatus(): { running: boolean; pages?: number } {
  if (!browser || !browser.connected) {
    return { running: false };
  }

  return { running: true };
}
```

### 3.3 Key Concepts Explained

**userDataDir:**
- Stores cookies, localStorage, extensions, etc.
- We use `app.getPath('userData')` which is the standard Electron user data folder
- This means logins persist between browser sessions

**Extension Loading:**
- `--load-extension=path` tells Chromium to load our extension
- We must NOT use `--disable-extensions` (Puppeteer default)
- Hence `ignoreDefaultArgs: ['--disable-extensions']`

**Browser Lifecycle:**
- `browser.on('disconnected')` fires when user closes browser
- We clean up our reference so we know to relaunch next time

---

## Step 4: Create IPC Handlers

Create: `packages/desktop/electron/main/ipc-handlers/research-browser.ts`

### 4.1 Understanding IPC

IPC (Inter-Process Communication) lets the renderer (UI) talk to the main process. In Electron:
- Renderer can't launch browsers directly (security)
- Main process can do anything
- IPC bridges the gap

### 4.2 Implementation

```typescript
/**
 * research-browser.ts
 *
 * IPC handlers for the Research Browser feature.
 * Channel naming follows CLAUDE.md convention: domain:action
 */
import { ipcMain } from 'electron';
import {
  launchResearchBrowser,
  closeResearchBrowser,
  getResearchBrowserStatus,
} from '../../services/research-browser-service';

/**
 * Register all Research Browser IPC handlers
 */
export function registerResearchBrowserHandlers(): void {
  // research:launch - Launch the browser
  ipcMain.handle('research:launch', async () => {
    return await launchResearchBrowser();
  });

  // research:close - Close the browser
  ipcMain.handle('research:close', async () => {
    await closeResearchBrowser();
    return { success: true };
  });

  // research:status - Get browser status
  ipcMain.handle('research:status', async () => {
    return getResearchBrowserStatus();
  });
}
```

### 4.3 Key Concepts Explained

**ipcMain.handle:**
- Registers a handler for async requests from renderer
- Returns a Promise that resolves with the response
- Renderer calls via `ipcRenderer.invoke('channel-name')`

**Channel Naming:**
- Per CLAUDE.md: `domain:action` format
- `research:launch`, `research:close`, `research:status`

---

## Step 5: Update Preload Bridge

### 5.1 Understanding Preload

The preload script is the bridge between main and renderer:
- Has access to Electron APIs
- Exposes safe APIs to renderer via contextBridge
- MUST be CommonJS (.cjs) per CLAUDE.md

### 5.2 Update packages/desktop/electron/preload/index.ts

Add to the existing file:

```typescript
// Add to imports (if not already present)
// Note: This file generates preload.cjs via build

// Add to electronAPI object:
research: {
  launch: () => ipcRenderer.invoke('research:launch'),
  close: () => ipcRenderer.invoke('research:close'),
  status: () => ipcRenderer.invoke('research:status'),
},
```

### 5.3 Update packages/desktop/electron/preload/preload.cjs

Add to the contextBridge.exposeInMainWorld section:

```javascript
research: {
  launch: () => ipcRenderer.invoke('research:launch'),
  close: () => ipcRenderer.invoke('research:close'),
  status: () => ipcRenderer.invoke('research:status'),
},
```

### 5.4 Update Type Definitions

Update `packages/desktop/src/types/electron.d.ts`:

```typescript
// Add to ElectronAPI interface:
research: {
  launch: () => Promise<{ success: boolean; error?: string }>;
  close: () => Promise<{ success: boolean }>;
  status: () => Promise<{ running: boolean; pages?: number }>;
};
```

---

## Step 6: Create Browser Extension

### 6.1 Understanding Browser Extensions

A browser extension is a mini web app that runs inside the browser:
- `manifest.json` - Defines extension metadata and permissions
- `popup.html` - UI that appears when clicking extension icon
- `background.js` - Background script (service worker in MV3)

### 6.2 Create Directory Structure

```
resources/
└── extension/
    ├── manifest.json
    ├── popup.html
    ├── popup.js
    ├── popup.css
    ├── background.js
    └── icons/
        ├── icon16.png
        ├── icon48.png
        └── icon128.png
```

### 6.3 manifest.json

```json
{
  "manifest_version": 3,
  "name": "AU Archive Clipper",
  "version": "1.0.0",
  "description": "Save pages to Abandoned Upstate Archive",

  "permissions": [
    "activeTab",
    "storage"
  ],

  "host_permissions": [
    "http://localhost:47123/*"
  ],

  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    },
    "default_title": "Save to AU Archive"
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

### 6.4 popup.html

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div class="container">
    <h1>AU Archive</h1>

    <div id="status" class="status"></div>

    <div id="form">
      <div class="field">
        <label>URL</label>
        <div id="url" class="url-display"></div>
      </div>

      <div class="field">
        <label for="title">Title</label>
        <input type="text" id="title" placeholder="Page title">
      </div>

      <div class="field">
        <label for="location-search">Link to Location</label>
        <input type="text" id="location-search" placeholder="Search locations...">
        <div id="location-results" class="results"></div>
        <input type="hidden" id="locid">
      </div>

      <button id="save-btn" class="primary">Save Bookmark</button>
    </div>

    <div id="recent" class="recent">
      <h3>Quick Save To:</h3>
      <div id="recent-locations"></div>
    </div>
  </div>

  <script src="popup.js"></script>
</body>
</html>
```

### 6.5 popup.css

```css
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 14px;
  width: 320px;
  color: #333;
}

.container {
  padding: 16px;
}

h1 {
  font-size: 18px;
  color: #b9975c;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid #eee;
}

.status {
  padding: 8px;
  border-radius: 4px;
  margin-bottom: 12px;
  font-size: 12px;
}

.status.error {
  background: #fee;
  color: #c00;
}

.status.success {
  background: #efe;
  color: #060;
}

.field {
  margin-bottom: 12px;
}

label {
  display: block;
  font-size: 12px;
  color: #666;
  margin-bottom: 4px;
}

input[type="text"] {
  width: 100%;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
}

input[type="text"]:focus {
  outline: none;
  border-color: #b9975c;
}

.url-display {
  font-size: 12px;
  color: #666;
  word-break: break-all;
  padding: 4px 0;
}

.results {
  max-height: 120px;
  overflow-y: auto;
  border: 1px solid #ddd;
  border-top: none;
  border-radius: 0 0 4px 4px;
  display: none;
}

.results.show {
  display: block;
}

.result-item {
  padding: 8px;
  cursor: pointer;
  border-bottom: 1px solid #eee;
}

.result-item:hover {
  background: #f5f5f5;
}

.result-item:last-child {
  border-bottom: none;
}

.result-state {
  font-size: 11px;
  color: #999;
}

button.primary {
  width: 100%;
  padding: 10px;
  background: #b9975c;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
}

button.primary:hover {
  background: #a8864b;
}

button.primary:disabled {
  background: #ccc;
  cursor: not-allowed;
}

.recent {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid #eee;
}

.recent h3 {
  font-size: 12px;
  color: #666;
  margin-bottom: 8px;
}

#recent-locations {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.quick-loc {
  padding: 4px 8px;
  background: #f0f0f0;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
}

.quick-loc:hover {
  background: #e0e0e0;
}
```

### 6.6 popup.js

```javascript
/**
 * popup.js
 *
 * Extension popup UI logic
 */

const API_BASE = 'http://localhost:47123';

// DOM elements
let urlDisplay, titleInput, locationSearch, locationResults, locidInput;
let saveBtn, statusDiv, recentLocations;

// State
let selectedLocid = null;
let searchTimeout = null;

/**
 * Initialize popup
 */
async function init() {
  // Get DOM elements
  urlDisplay = document.getElementById('url');
  titleInput = document.getElementById('title');
  locationSearch = document.getElementById('location-search');
  locationResults = document.getElementById('location-results');
  locidInput = document.getElementById('locid');
  saveBtn = document.getElementById('save-btn');
  statusDiv = document.getElementById('status');
  recentLocations = document.getElementById('recent-locations');

  // Check if AU Archive is running
  const running = await checkStatus();
  if (!running) {
    showStatus('AU Archive app is not running. Please start the app first.', 'error');
    saveBtn.disabled = true;
    return;
  }

  // Get current tab info
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    urlDisplay.textContent = tab.url;
    titleInput.value = tab.title || '';
  }

  // Set up event listeners
  saveBtn.addEventListener('click', handleSave);
  locationSearch.addEventListener('input', handleLocationSearch);

  // Load recent bookmarks for quick-save
  await loadRecentLocations();
}

/**
 * Check if AU Archive app is running
 */
async function checkStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/status`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Show status message
 */
function showStatus(message, type = 'info') {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  statusDiv.style.display = 'block';
}

/**
 * Handle location search
 */
async function handleLocationSearch() {
  const query = locationSearch.value.trim();

  // Clear previous timeout
  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }

  // Hide results if empty
  if (!query) {
    locationResults.classList.remove('show');
    selectedLocid = null;
    return;
  }

  // Debounce search
  searchTimeout = setTimeout(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/locations?search=${encodeURIComponent(query)}`);
      const data = await res.json();

      if (data.locations && data.locations.length > 0) {
        locationResults.innerHTML = data.locations.map(loc => `
          <div class="result-item" data-locid="${loc.locid}" data-name="${loc.locnam}">
            ${loc.locnam}
            ${loc.address_state ? `<span class="result-state">(${loc.address_state})</span>` : ''}
          </div>
        `).join('');

        // Add click handlers
        locationResults.querySelectorAll('.result-item').forEach(item => {
          item.addEventListener('click', () => {
            selectedLocid = item.dataset.locid;
            locationSearch.value = item.dataset.name;
            locationResults.classList.remove('show');
          });
        });

        locationResults.classList.add('show');
      } else {
        locationResults.classList.remove('show');
      }
    } catch (error) {
      console.error('Search error:', error);
    }
  }, 300);
}

/**
 * Handle save bookmark
 */
async function handleSave() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  try {
    const res = await fetch(`${API_BASE}/api/bookmark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: tab.url,
        title: titleInput.value || tab.title,
        locid: selectedLocid,
      }),
    });

    const data = await res.json();

    if (data.success) {
      showStatus('Bookmark saved!', 'success');

      // Update badge
      chrome.action.setBadgeText({ text: '✓', tabId: tab.id });
      chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });

      // Clear badge after 2 seconds
      setTimeout(() => {
        chrome.action.setBadgeText({ text: '', tabId: tab.id });
      }, 2000);

      // Close popup after brief delay
      setTimeout(() => window.close(), 1000);
    } else {
      showStatus(`Error: ${data.error}`, 'error');
    }
  } catch (error) {
    showStatus('Failed to save. Is AU Archive running?', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Bookmark';
  }
}

/**
 * Load recent locations for quick-save buttons
 */
async function loadRecentLocations() {
  try {
    const res = await fetch(`${API_BASE}/api/recent?limit=5`);
    const data = await res.json();

    if (data.bookmarks && data.bookmarks.length > 0) {
      // Get unique locations from recent bookmarks
      const seen = new Set();
      const locations = [];

      for (const bm of data.bookmarks) {
        if (bm.locid && bm.locnam && !seen.has(bm.locid)) {
          seen.add(bm.locid);
          locations.push({ locid: bm.locid, locnam: bm.locnam });
        }
        if (locations.length >= 3) break;
      }

      if (locations.length > 0) {
        recentLocations.innerHTML = locations.map(loc => `
          <span class="quick-loc" data-locid="${loc.locid}">${loc.locnam}</span>
        `).join('');

        // Add click handlers
        recentLocations.querySelectorAll('.quick-loc').forEach(btn => {
          btn.addEventListener('click', () => {
            selectedLocid = btn.dataset.locid;
            locationSearch.value = btn.textContent;
            handleSave();
          });
        });
      }
    }
  } catch (error) {
    console.error('Failed to load recent locations:', error);
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
```

### 6.7 background.js

```javascript
/**
 * background.js
 *
 * Extension service worker (background script)
 */

const API_BASE = 'http://localhost:47123';

// Check if AU Archive is running when extension loads
chrome.runtime.onInstalled.addListener(async () => {
  console.log('AU Archive Clipper installed');
});

// Optional: Add context menu for right-click save
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'save-to-archive',
    title: 'Save to AU Archive',
    contexts: ['page', 'link'],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'save-to-archive') {
    const url = info.linkUrl || info.pageUrl;

    try {
      const res = await fetch(`${API_BASE}/api/bookmark`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url,
          title: tab?.title || url,
          locid: null,
        }),
      });

      const data = await res.json();

      if (data.success && tab?.id) {
        chrome.action.setBadgeText({ text: '✓', tabId: tab.id });
        chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
        setTimeout(() => {
          chrome.action.setBadgeText({ text: '', tabId: tab.id });
        }, 2000);
      }
    } catch (error) {
      console.error('Failed to save bookmark:', error);
    }
  }
});
```

### 6.8 Create Icons

For now, create placeholder icons. You can replace with proper AU Archive branded icons later.

Create 16x16, 48x48, and 128x128 PNG files in `resources/extension/icons/`.

---

## Step 7: Update Navigation

### 7.1 Modify Navigation.svelte

Update `packages/desktop/src/components/Navigation.svelte`:

```svelte
<script lang="ts">
  import { router } from '../stores/router';
  import { openImportModal } from '../stores/import-modal-store';
  import logo from '../assets/abandoned-upstate-logo.png';

  let currentRoute = $state('/dashboard');
  let researchBrowserRunning = $state(false);

  $effect(() => {
    const unsubscribe = router.subscribe((route) => {
      currentRoute = route.path;
    });
    return () => unsubscribe();
  });

  // Navigation order per spec
  const menuItems = [
    { path: '/dashboard', label: 'Dashboard' },
    { path: '/locations', label: 'Locations' },
    // Research is handled separately (launches browser)
    { path: '/atlas', label: 'Atlas' },
  ];

  function navigate(path: string) {
    router.navigate(path);
  }

  function isActive(path: string): boolean {
    return currentRoute === path;
  }

  async function launchResearch() {
    if (!window.electronAPI?.research) {
      console.error('Research API not available');
      return;
    }

    const result = await window.electronAPI.research.launch();
    if (result.success) {
      researchBrowserRunning = true;
    } else {
      console.error('Failed to launch research browser:', result.error);
      // Could show a toast/notification here
    }
  }

  // Check browser status periodically
  $effect(() => {
    const checkStatus = async () => {
      if (window.electronAPI?.research) {
        const status = await window.electronAPI.research.status();
        researchBrowserRunning = status.running;
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  });
</script>

<nav class="w-64 h-screen bg-background text-foreground flex flex-col border-r border-gray-200">
  <div class="p-6 border-b border-gray-200 text-center">
    <img src={logo} alt="Abandoned Upstate" class="h-20 w-auto mx-auto mb-2" />
    <p class="text-sm font-heading font-semibold text-accent tracking-wide">Archive Tool</p>
  </div>

  <!-- New Location button -->
  <div class="px-4 py-3 border-b border-gray-200">
    <button
      onclick={() => openImportModal()}
      class="w-full px-4 py-2 bg-accent text-white rounded-lg hover:opacity-90 transition font-medium text-sm flex items-center justify-center gap-2"
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
      </svg>
      New Location
    </button>
  </div>

  <div class="flex-1 overflow-y-auto">
    <ul class="py-4">
      {#each menuItems as item}
        <li>
          <button
            onclick={() => navigate(item.path)}
            class="w-full px-6 py-3 text-left hover:bg-gray-100 transition-colors {isActive(item.path) ? 'bg-gray-100 border-l-4 border-accent' : ''}"
          >
            <span class="text-sm font-medium">{item.label}</span>
          </button>
        </li>
      {/each}

      <!-- Research Browser - Special handling -->
      <li>
        <button
          onclick={launchResearch}
          class="w-full px-6 py-3 text-left hover:bg-gray-100 transition-colors flex items-center justify-between"
        >
          <span class="text-sm font-medium">Research</span>
          {#if researchBrowserRunning}
            <span class="w-2 h-2 bg-green-500 rounded-full" title="Browser running"></span>
          {/if}
        </button>
      </li>
    </ul>
  </div>

  <!-- Bottom Icon Bar -->
  <div class="p-4 border-t border-gray-200">
    <div class="flex justify-between items-center">
      <button
        onclick={() => navigate('/search')}
        class="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors {isActive('/search') ? 'bg-gray-100' : ''}"
        title="Search"
      >
        <svg class="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <span class="text-sm text-gray-600">Search</span>
      </button>
      <button
        onclick={() => navigate('/settings')}
        class="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors {isActive('/settings') ? 'bg-gray-100' : ''}"
        title="Settings"
      >
        <svg class="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span class="text-sm text-gray-600">Settings</span>
      </button>
    </div>
  </div>
</nav>

<style>
  .border-accent {
    border-color: #b9975c;
  }
</style>
```

---

## Step 8: Initialize Services

### 8.1 Update Main Process

Modify `packages/desktop/electron/main/index.ts`:

```typescript
// Add imports at top
import { startBookmarkAPIServer, stopBookmarkAPIServer } from '../services/bookmark-api-server';
import { closeResearchBrowser } from '../services/research-browser-service';
import { registerResearchBrowserHandlers } from './ipc-handlers/research-browser';

// In startupOrchestrator(), after IPC handlers are registered:
// Step X: Start Bookmark API Server
logger.info('Main', 'Starting Bookmark API Server');
try {
  await startBookmarkAPIServer(bookmarksRepository, locationsRepository);
  logger.info('Main', 'Bookmark API Server started');
} catch (error) {
  logger.error('Main', `Failed to start Bookmark API Server: ${error}`);
  // Non-fatal - app can still work without research browser
}

// Also register research browser handlers
registerResearchBrowserHandlers();

// In app.on('before-quit') or cleanup:
await stopBookmarkAPIServer();
await closeResearchBrowser();
```

---

## Step 9: Bundle Ungoogled Chromium

### 9.1 Download Binaries

1. Visit https://ungoogled-software.github.io/ungoogled-chromium-binaries/
2. Download for each platform:
   - macOS arm64
   - macOS x64
   - Windows x64
   - Linux x64

### 9.2 Extract and Place

```
resources/
└── browsers/
    └── ungoogled-chromium/
        ├── mac-arm64/
        │   └── Chromium.app/
        ├── mac-x64/
        │   └── Chromium.app/
        ├── win-x64/
        │   └── chrome.exe (and other files)
        └── linux-x64/
            └── chrome (and other files)
```

### 9.3 Update electron-builder.config

Ensure the browsers directory is included in builds:

```json
{
  "extraResources": [
    {
      "from": "resources/browsers",
      "to": "browsers",
      "filter": ["**/*"]
    },
    {
      "from": "resources/extension",
      "to": "extension",
      "filter": ["**/*"]
    }
  ]
}
```

---

## Step 10: Cleanup Old Code

### 10.1 Files to Delete

- `packages/desktop/src/pages/WebBrowser.svelte`
- `packages/desktop/electron/services/browser-view-manager.ts`

### 10.2 Update Router

Remove `/browser` route from router if it exists.

### 10.3 Remove Old Imports

Search for and remove any imports of:
- `BrowserViewManager`
- `initBrowserViewManager`
- `destroyBrowserViewManager`

---

## Testing

### Manual Testing Checklist

1. [ ] Start AU Archive app
2. [ ] Click "Research" in navigation
3. [ ] Ungoogled Chromium opens
4. [ ] Extension icon visible in browser toolbar
5. [ ] Click extension → popup opens
6. [ ] Location search returns results
7. [ ] Save bookmark with location link
8. [ ] Check bookmark appears in database
9. [ ] Close browser
10. [ ] Green dot disappears from navigation
11. [ ] Relaunch browser
12. [ ] Previous logins still work (profile persists)

### Automated Tests

Create tests for:
- BookmarkAPIServer endpoints
- ResearchBrowserService launch/close
- IPC handlers

---

## Troubleshooting

### Browser Won't Launch

1. Check Chromium path is correct for platform
2. Verify Chromium binary has execute permissions (Linux/Mac)
3. Check console for puppeteer errors

### Extension Not Showing

1. Verify extension path is correct
2. Check manifest.json is valid JSON
3. Look for extension errors in browser devtools

### API Calls Failing

1. Verify AU Archive app is running
2. Check port 47123 isn't in use
3. Look for CORS errors in browser devtools

### Logins Not Persisting

1. Verify userDataDir path exists
2. Check profile isn't being deleted
3. Ensure browser is closing gracefully

---

## Summary

You've implemented:
1. HTTP server for extension communication
2. Puppeteer-based browser launcher
3. Browser extension with bookmark UI
4. Navigation integration

The user can now click "Research" to open a de-Googled browser, save bookmarks to their locations, and have their logins persist for future archiving workflows.
