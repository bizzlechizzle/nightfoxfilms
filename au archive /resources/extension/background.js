/**
 * background.js
 *
 * Extension service worker for AU Archive Clipper
 * Handles:
 * - Side panel opening and context menu for quick bookmarking
 * - Browser command handling for zero-detection Research Browser
 * - Tab event reporting to main application
 *
 * Communication Protocol:
 * - Connects to WebSocket server on ws://localhost:47124
 * - Registers as 'extension:register' to enable browser commands
 * - Receives 'browser:command' messages and executes them
 * - Sends 'browser:response' with results
 * - Reports 'browser:event' for tab changes, navigation, etc.
 */

const API_BASE = 'http://localhost:47123';
const WS_URL = 'ws://localhost:47124';

// Menu item IDs
const MENU_PARENT = 'au-archive-menu';
const MENU_SEPARATOR = 'menu-separator';
const MENU_CHOOSE = 'choose-location';
const MENU_LOC_PREFIX = 'location-';

// Cache for recent locations
let recentLocations = [];

// WebSocket connection for browser commands
let commandSocket = null;
let commandSocketReconnectTimeout = null;
const HEARTBEAT_INTERVAL = 5000; // 5 seconds
let heartbeatInterval = null;

/**
 * Set side panel to open on action click
 */
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('[AU Archive] Failed to set panel behavior:', error));

/**
 * Fetch recent locations from the API
 */
async function fetchRecentLocations() {
  try {
    const res = await fetch(`${API_BASE}/api/recent-locations?limit=5`, {
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) {
      const data = await res.json();
      recentLocations = data.locations || [];
      return true;
    }
  } catch (error) {
    console.log('[AU Archive] App not running, context menu will show basic options');
  }
  recentLocations = [];
  return false;
}

/**
 * Build the context menu with current recent locations
 */
async function buildContextMenu() {
  // Remove all existing menu items first
  await chrome.contextMenus.removeAll();

  // Create parent menu
  chrome.contextMenus.create({
    id: MENU_PARENT,
    title: 'Save to AU Archive',
    contexts: ['page', 'link'],
  });

  // Only add location options if we have any
  if (recentLocations.length > 0) {
    // Recent locations
    for (let i = 0; i < recentLocations.length; i++) {
      const loc = recentLocations[i];
      const stateStr = loc.address_state ? ` (${loc.address_state})` : '';
      chrome.contextMenus.create({
        id: `${MENU_LOC_PREFIX}${loc.locid}`,
        parentId: MENU_PARENT,
        title: `${loc.locnam}${stateStr}`,
        contexts: ['page', 'link'],
      });
    }

    // Separator before "Choose Location"
    chrome.contextMenus.create({
      id: `${MENU_SEPARATOR}-2`,
      parentId: MENU_PARENT,
      type: 'separator',
      contexts: ['page', 'link'],
    });
  }

  // Open Panel (for full search)
  chrome.contextMenus.create({
    id: MENU_CHOOSE,
    parentId: MENU_PARENT,
    title: 'Open Panel...',
    contexts: ['page', 'link'],
  });
}

/**
 * Capture a screenshot of the current tab
 * Returns base64 data URL or null if capture fails
 */
async function captureScreenshot(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.windowId) return null;

    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'jpeg',
      quality: 80,
    });

    return dataUrl;
  } catch (error) {
    console.log('[AU Archive] Screenshot capture failed:', error.message);
    return null;
  }
}

/**
 * Save a bookmark via the API
 */
async function saveBookmark(url, title, locid = null, tabId = null) {
  try {
    // Try to capture a screenshot if we have a tab ID
    let thumbnail = null;
    if (tabId) {
      thumbnail = await captureScreenshot(tabId);
    }

    const res = await fetch(`${API_BASE}/api/bookmark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, title, locid, thumbnail }),
    });

    const data = await res.json();
    return data.success;
  } catch (error) {
    console.error('[AU Archive] Failed to save bookmark:', error);
    return false;
  }
}

/**
 * Show success badge on the extension icon
 */
function showSuccessBadge(tabId) {
  if (!tabId) return;

  chrome.action.setBadgeText({ text: '✓', tabId });
  chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });

  setTimeout(() => {
    chrome.action.setBadgeText({ text: '', tabId });
  }, 2000);
}

/**
 * Show error badge on the extension icon
 */
function showErrorBadge(tabId) {
  if (!tabId) return;

  chrome.action.setBadgeText({ text: '!', tabId });
  chrome.action.setBadgeBackgroundColor({ color: '#f44336' });

  setTimeout(() => {
    chrome.action.setBadgeText({ text: '', tabId });
  }, 2000);
}

/**
 * Handle context menu clicks
 */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const menuItemId = info.menuItemId;
  const url = info.linkUrl || info.pageUrl;
  const title = tab?.title || url;
  const tabId = tab?.id || null;

  // Open Panel - open the side panel
  if (menuItemId === MENU_CHOOSE) {
    if (tabId) {
      chrome.sidePanel.open({ tabId });
    }
    return;
  }

  // Location-specific save - OPT-115: Use full capture
  if (typeof menuItemId === 'string' && menuItemId.startsWith(MENU_LOC_PREFIX)) {
    const locid = menuItemId.replace(MENU_LOC_PREFIX, '');
    const success = await saveBookmarkWithCapture(url, title, locid, tabId);
    if (success) {
      showSuccessBadge(tabId);
      // Refresh menu - this location should now be at the top
      await fetchRecentLocations();
      await buildContextMenu();
    } else {
      showErrorBadge(tabId);
    }
    return;
  }
});

/**
 * Initialize extension on install/update
 */
chrome.runtime.onInstalled.addListener(async () => {
  console.log('[AU Archive] Extension installed/updated');
  await fetchRecentLocations();
  await buildContextMenu();
});

/**
 * Refresh menu when service worker starts (e.g., browser restart)
 */
chrome.runtime.onStartup.addListener(async () => {
  console.log('[AU Archive] Extension starting up');
  await fetchRecentLocations();
  await buildContextMenu();
});

// Initial setup when service worker loads
(async () => {
  await fetchRecentLocations();
  await buildContextMenu();
  // Connect to command WebSocket for browser control
  connectCommandSocket();
})();

// ============================================================================
// Browser Command WebSocket - Zero-Detection Research Browser Support
// ============================================================================

/**
 * Connect to the AU Archive WebSocket server for browser commands
 */
function connectCommandSocket() {
  if (commandSocket && commandSocket.readyState === WebSocket.OPEN) {
    return;
  }

  try {
    commandSocket = new WebSocket(WS_URL);

    commandSocket.onopen = () => {
      console.log('[AU Archive] Command WebSocket connected');

      // Register as browser extension for commands
      commandSocket.send(JSON.stringify({ type: 'extension:register' }));

      // Start heartbeat
      startHeartbeat();

      // Clear any pending reconnect
      if (commandSocketReconnectTimeout) {
        clearTimeout(commandSocketReconnectTimeout);
        commandSocketReconnectTimeout = null;
      }

      // Report extension ready
      sendBrowserEvent({ name: 'extensionReady' });
    };

    commandSocket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleCommandMessage(message);
      } catch (err) {
        console.error('[AU Archive] Invalid command message:', err);
      }
    };

    commandSocket.onclose = () => {
      console.log('[AU Archive] Command WebSocket disconnected');
      stopHeartbeat();
      scheduleCommandReconnect();
    };

    commandSocket.onerror = (err) => {
      console.error('[AU Archive] Command WebSocket error:', err);
    };
  } catch (err) {
    console.error('[AU Archive] Command WebSocket connection failed:', err);
    scheduleCommandReconnect();
  }
}

/**
 * Schedule WebSocket reconnection
 */
function scheduleCommandReconnect() {
  if (commandSocketReconnectTimeout) return;

  commandSocketReconnectTimeout = setTimeout(() => {
    commandSocketReconnectTimeout = null;
    connectCommandSocket();
  }, 5000);
}

/**
 * Start heartbeat to keep connection alive
 */
function startHeartbeat() {
  stopHeartbeat();
  heartbeatInterval = setInterval(() => {
    if (commandSocket && commandSocket.readyState === WebSocket.OPEN) {
      commandSocket.send(JSON.stringify({ type: 'extension:heartbeat' }));
    }
  }, HEARTBEAT_INTERVAL);
}

/**
 * Stop heartbeat
 */
function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

/**
 * Handle incoming command messages from main app
 */
function handleCommandMessage(message) {
  if (message.type === 'browser:command') {
    executeBrowserCommand(message.requestId, message.command);
  } else if (message.type === 'heartbeat:ack') {
    // Heartbeat acknowledged
  }
}

/**
 * Execute a browser command and send response
 */
async function executeBrowserCommand(requestId, command) {
  let response = { type: 'browser:response', requestId, success: false };

  try {
    switch (command.action) {
      case 'navigate':
        response = await handleNavigateCommand(requestId, command.url);
        break;

      case 'newTab':
        response = await handleNewTabCommand(requestId, command.url);
        break;

      case 'closeTab':
        response = await handleCloseTabCommand(requestId, command.tabId);
        break;

      case 'screenshot':
        response = await handleScreenshotCommand(requestId);
        break;

      case 'getActiveTab':
        response = await handleGetActiveTabCommand(requestId);
        break;

      case 'getTabs':
        response = await handleGetTabsCommand(requestId);
        break;

      case 'focusTab':
        response = await handleFocusTabCommand(requestId, command.tabId);
        break;

      case 'ping':
        response = { type: 'browser:response', requestId, success: true, data: 'pong' };
        break;

      case 'capturePage':
        response = await handleCapturePageCommand(requestId, command.tabId);
        break;

      default:
        response = {
          type: 'browser:response',
          requestId,
          success: false,
          error: `Unknown command: ${command.action}`,
        };
    }
  } catch (error) {
    response = {
      type: 'browser:response',
      requestId,
      success: false,
      error: error.message || String(error),
    };
  }

  // Send response
  if (commandSocket && commandSocket.readyState === WebSocket.OPEN) {
    commandSocket.send(JSON.stringify(response));
  }
}

/**
 * Send a browser event to the main app
 */
function sendBrowserEvent(event) {
  if (commandSocket && commandSocket.readyState === WebSocket.OPEN) {
    commandSocket.send(JSON.stringify({
      type: 'browser:event',
      event,
    }));
  }
}

// ============================================================================
// Command Handlers
// ============================================================================

/**
 * Navigate active tab to URL
 */
async function handleNavigateCommand(requestId, url) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    return { type: 'browser:response', requestId, success: false, error: 'No active tab' };
  }

  await chrome.tabs.update(tab.id, { url });
  return { type: 'browser:response', requestId, success: true, data: { tabId: tab.id } };
}

/**
 * Open new tab with optional URL
 */
async function handleNewTabCommand(requestId, url) {
  const tab = await chrome.tabs.create({ url: url || 'about:blank' });
  return { type: 'browser:response', requestId, success: true, data: { tabId: tab.id } };
}

/**
 * Close a specific tab or active tab
 */
async function handleCloseTabCommand(requestId, tabId) {
  if (tabId) {
    await chrome.tabs.remove(tabId);
  } else {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      await chrome.tabs.remove(tab.id);
    }
  }
  return { type: 'browser:response', requestId, success: true };
}

/**
 * Capture screenshot of active tab
 */
async function handleScreenshotCommand(requestId) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.windowId) {
      return { type: 'browser:response', requestId, success: false, error: 'No active tab' };
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'jpeg',
      quality: 80,
    });

    return { type: 'browser:response', requestId, success: true, data: dataUrl };
  } catch (error) {
    return { type: 'browser:response', requestId, success: false, error: error.message };
  }
}

/**
 * Get information about the active tab
 */
async function handleGetActiveTabCommand(requestId) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    return { type: 'browser:response', requestId, success: false, error: 'No active tab' };
  }

  return {
    type: 'browser:response',
    requestId,
    success: true,
    data: {
      tabId: tab.id,
      url: tab.url || '',
      title: tab.title || '',
    },
  };
}

/**
 * Get all open tabs
 */
async function handleGetTabsCommand(requestId) {
  const tabs = await chrome.tabs.query({});
  const tabData = tabs.map((tab) => ({
    id: tab.id,
    url: tab.url || '',
    title: tab.title || '',
    active: tab.active,
    windowId: tab.windowId,
  }));

  return { type: 'browser:response', requestId, success: true, data: tabData };
}

/**
 * Focus a specific tab
 */
async function handleFocusTabCommand(requestId, tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab) {
    return { type: 'browser:response', requestId, success: false, error: 'Tab not found' };
  }

  // Focus the window first
  await chrome.windows.update(tab.windowId, { focused: true });
  // Then activate the tab
  await chrome.tabs.update(tabId, { active: true });

  return { type: 'browser:response', requestId, success: true };
}

// ============================================================================
// Tab Event Listeners - Report browser state changes to main app
// ============================================================================

/**
 * Report when a tab becomes active
 */
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    sendBrowserEvent({
      name: 'tabActivated',
      tabId: tab.id,
      url: tab.url || '',
      title: tab.title || '',
    });
  } catch (error) {
    console.log('[AU Archive] Error getting activated tab:', error.message);
  }
});

/**
 * Report when a tab is updated (URL change, title change, etc.)
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only report when page finishes loading or URL changes
  if (changeInfo.status === 'complete' || changeInfo.url) {
    sendBrowserEvent({
      name: 'tabUpdated',
      tabId,
      url: tab.url || '',
      title: tab.title || '',
    });
  }
});

/**
 * Report when a tab is closed
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  sendBrowserEvent({
    name: 'tabClosed',
    tabId,
  });
});

// ============================================================================
// OPT-121: Complete Page Capture - Extension-First Archiving
// Premium capture system that captures EVERYTHING while user is authenticated
// ============================================================================

/**
 * Progress stages for user feedback
 */
const CaptureStage = {
  STARTING: { badge: '◐', color: '#2196F3' },
  SCREENSHOT: { badge: '◑', color: '#FF9800' },
  SCROLLING: { badge: '◒', color: '#FF9800' },
  CONTENT: { badge: '◓', color: '#FF9800' },
  COOKIES: { badge: '◐', color: '#9C27B0' },
  SAVING: { badge: '◑', color: '#9C27B0' },
  COMPLETE: { badge: '✓', color: '#4CAF50' },
  ERROR: { badge: '✗', color: '#f44336' },
};

/**
 * Update capture progress badge
 */
async function setCaptureProgress(tabId, stage) {
  if (!tabId) return;
  const { badge, color } = CaptureStage[stage] || CaptureStage.STARTING;
  try {
    await chrome.action.setBadgeText({ text: badge, tabId });
    await chrome.action.setBadgeBackgroundColor({ color, tabId });
  } catch (e) {
    // Tab may have closed
  }
}

/**
 * Sleep helper for scroll timing
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Capture full-page screenshot by scrolling and stitching
 * Returns array of screenshot segments for server-side stitching
 */
async function captureFullPageScreenshot(tabId, windowId) {
  try {
    // Get page dimensions
    const [{ result: dims }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        scrollHeight: Math.max(
          document.documentElement.scrollHeight,
          document.body.scrollHeight
        ),
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        originalScrollY: window.scrollY,
      }),
    });

    const { scrollHeight, viewportHeight, originalScrollY } = dims;
    const screenshots = [];
    const maxScrolls = 10; // Limit to prevent huge captures
    let scrollCount = 0;

    // Scroll to top
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.scrollTo(0, 0),
    });
    await sleep(200);

    // Capture each viewport
    let currentY = 0;
    while (currentY < scrollHeight && scrollCount < maxScrolls) {
      const screenshot = await chrome.tabs.captureVisibleTab(windowId, {
        format: 'png',
      });

      screenshots.push({
        y: currentY,
        data: screenshot,
        height: viewportHeight,
      });

      currentY += viewportHeight;
      scrollCount++;

      if (currentY < scrollHeight) {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (y) => window.scrollTo(0, y),
          args: [currentY],
        });
        await sleep(200); // Wait for render and lazy-load images
      }
    }

    // Restore original scroll position
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (y) => window.scrollTo(0, y),
      args: [originalScrollY],
    });

    return {
      segments: screenshots,
      totalHeight: scrollHeight,
      viewportHeight,
      viewportWidth: dims.viewportWidth,
      isFullPage: screenshots.length > 1,
    };
  } catch (err) {
    console.error('[AU Archive] Full-page screenshot failed:', err);
    // Fall back to single viewport capture
    const screenshot = await chrome.tabs.captureVisibleTab(windowId, {
      format: 'png',
    });
    return {
      segments: [{ y: 0, data: screenshot, height: 0 }],
      isFullPage: false,
    };
  }
}

/**
 * Capture all cookies for domain and parent domains
 */
async function captureAllCookies(url) {
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;

    // Get cookies for exact URL
    const urlCookies = await chrome.cookies.getAll({ url });

    // Get cookies for domain (includes subdomains)
    const domainCookies = await chrome.cookies.getAll({ domain });

    // Get cookies for parent domain (e.g., .redfin.com)
    const parts = domain.split('.');
    let parentCookies = [];
    if (parts.length > 2) {
      const parentDomain = '.' + parts.slice(-2).join('.');
      parentCookies = await chrome.cookies.getAll({ domain: parentDomain });
    }

    // Merge and dedupe by name+domain+path
    const cookieMap = new Map();
    [...urlCookies, ...domainCookies, ...parentCookies].forEach(c => {
      const key = `${c.name}|${c.domain}|${c.path}`;
      if (!cookieMap.has(key)) {
        cookieMap.set(key, {
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          secure: c.secure,
          httpOnly: c.httpOnly,
          sameSite: c.sameSite || 'unspecified',
          expirationDate: c.expirationDate,
        });
      }
    });

    const cookies = Array.from(cookieMap.values());
    console.log(`[AU Archive] Captured ${cookies.length} cookies for ${domain}`);
    return cookies;
  } catch (err) {
    console.error('[AU Archive] Cookie capture failed:', err);
    return [];
  }
}

/**
 * Capture complete page state from the user's actual browser session
 * This captures everything the user sees - no second browser needed
 * OPT-121: Complete implementation with full-page screenshot and session data
 */
async function captureFullPage(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab || !tab.url) {
    throw new Error('Invalid tab');
  }

  // Stage 1: Start capture
  await setCaptureProgress(tabId, 'STARTING');

  // Stage 2: Capture full-page screenshot
  await setCaptureProgress(tabId, 'SCREENSHOT');
  let screenshotData = null;
  try {
    screenshotData = await captureFullPageScreenshot(tabId, tab.windowId);
    console.log(`[AU Archive] Captured ${screenshotData.segments.length} screenshot segments`);
  } catch (err) {
    console.log('[AU Archive] Screenshot capture failed:', err.message);
  }

  // Stage 3: Capture cookies
  await setCaptureProgress(tabId, 'COOKIES');
  const cookies = await captureAllCookies(tab.url);

  // Stage 4: Extract page content
  await setCaptureProgress(tabId, 'CONTENT');
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: extractPageContent,
  });
  const pageContent = results[0]?.result || {};

  // Get user agent from service worker context
  const userAgent = navigator.userAgent;

  // Build complete capture object
  return {
    url: tab.url,
    title: tab.title || pageContent.title || '',
    // Full-page screenshot data
    screenshot: screenshotData?.segments?.[0]?.data || null, // First segment for backward compat
    fullPageScreenshot: screenshotData, // Full data for server-side stitching
    // Session data for authenticated re-fetch
    cookies,
    userAgent,
    viewport: {
      width: screenshotData?.viewportWidth || tab.width || 1920,
      height: screenshotData?.viewportHeight || tab.height || 1080,
    },
    // Page content from content script
    ...pageContent,
    // Capture metadata
    capturedAt: new Date().toISOString(),
    captureVersion: '2.0', // OPT-121 complete capture
  };
}

/**
 * Content script function - runs in page context
 * Extracts all metadata, links, images from the current page
 */
function extractPageContent() {
  // Helper to safely get meta content
  const getMeta = (selector) => {
    const el = document.querySelector(selector);
    return el?.getAttribute('content') || el?.textContent || null;
  };

  // Extract Open Graph
  const openGraph = {
    title: getMeta('meta[property="og:title"]'),
    description: getMeta('meta[property="og:description"]'),
    image: getMeta('meta[property="og:image"]'),
    url: getMeta('meta[property="og:url"]'),
    type: getMeta('meta[property="og:type"]'),
    siteName: getMeta('meta[property="og:site_name"]'),
  };

  // Extract Twitter Cards
  const twitterCards = {
    card: getMeta('meta[name="twitter:card"]'),
    title: getMeta('meta[name="twitter:title"]'),
    description: getMeta('meta[name="twitter:description"]'),
    image: getMeta('meta[name="twitter:image"]'),
    creator: getMeta('meta[name="twitter:creator"]'),
  };

  // Extract standard meta
  const meta = {
    author: getMeta('meta[name="author"]'),
    description: getMeta('meta[name="description"]'),
    keywords: getMeta('meta[name="keywords"]'),
    publishDate: getMeta('meta[property="article:published_time"]') ||
                 getMeta('meta[name="date"]') ||
                 getMeta('meta[name="DC.date"]'),
    modifiedDate: getMeta('meta[property="article:modified_time"]'),
    publisher: getMeta('meta[property="article:publisher"]') ||
               getMeta('meta[name="publisher"]'),
  };

  // Extract Schema.org JSON-LD
  let schemaOrg = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    try {
      schemaOrg.push(JSON.parse(script.textContent));
    } catch (e) { /* ignore parse errors */ }
  });

  // Extract all links
  const links = [];
  document.querySelectorAll('a[href]').forEach((a) => {
    const href = a.href;
    if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
      links.push({
        url: href,
        text: a.textContent?.trim().substring(0, 200) || '',
        rel: a.getAttribute('rel') || null,
      });
    }
  });

  // Extract all images with full context
  const images = [];
  document.querySelectorAll('img').forEach((img, index) => {
    const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-original');
    if (!src || src.startsWith('data:')) return;

    // Find caption from figure/figcaption
    let caption = null;
    const figure = img.closest('figure');
    if (figure) {
      const figcaption = figure.querySelector('figcaption');
      caption = figcaption?.textContent?.trim() || null;
    }

    // Find credit/attribution
    let credit = null;
    const creditEl = figure?.querySelector('[class*="credit"], [class*="byline"]') ||
                     img.closest('[class*="credit"]');
    if (creditEl) credit = creditEl.textContent?.trim() || null;

    images.push({
      url: src,
      srcset: img.srcset || img.getAttribute('data-srcset') || null,
      alt: img.alt || null,
      width: img.naturalWidth || parseInt(img.getAttribute('width')) || 0,
      height: img.naturalHeight || parseInt(img.getAttribute('height')) || 0,
      caption,
      credit,
      attribution: img.getAttribute('data-credit') || img.getAttribute('data-attribution') || null,
      isHero: index === 0 || img.closest('[class*="hero"]') !== null,
    });
  });

  // Get full HTML
  const html = document.documentElement.outerHTML;

  // Extract main text content
  const bodyClone = document.body.cloneNode(true);
  bodyClone.querySelectorAll('script, style, nav, header, footer, aside').forEach(el => el.remove());
  const textContent = bodyClone.textContent?.replace(/\s+/g, ' ').trim() || '';

  // OPT-121: Capture localStorage and sessionStorage for session state
  let localStorageData = null;
  let sessionStorageData = null;
  try {
    const lsEntries = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      lsEntries[key] = localStorage.getItem(key);
    }
    localStorageData = JSON.stringify(lsEntries);
  } catch (e) { /* localStorage not accessible */ }

  try {
    const ssEntries = {};
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      ssEntries[key] = sessionStorage.getItem(key);
    }
    sessionStorageData = JSON.stringify(ssEntries);
  } catch (e) { /* sessionStorage not accessible */ }

  return {
    title: document.title,
    html,
    textContent: textContent.substring(0, 500000), // Limit to 500KB
    wordCount: textContent.split(/\s+/).filter(w => w.length > 0).length,
    domain: window.location.hostname.replace(/^www\./, ''),
    canonicalUrl: document.querySelector('link[rel="canonical"]')?.href || null,
    language: document.documentElement.lang || null,
    favicon: document.querySelector('link[rel="icon"]')?.href ||
             document.querySelector('link[rel="shortcut icon"]')?.href || null,
    openGraph,
    twitterCards,
    meta,
    schemaOrg,
    links: links.slice(0, 500), // Limit to 500 links
    images: images.slice(0, 100), // Limit to 100 images
    imageCount: images.length,
    linkCount: links.length,
    // OPT-121: Session storage data for authenticated re-fetch
    localStorage: localStorageData,
    sessionStorage: sessionStorageData,
  };
}

/**
 * Handle page capture command from main app
 */
async function handleCapturePageCommand(requestId, tabId) {
  try {
    // Use provided tabId or get active tab
    let targetTabId = tabId;
    if (!targetTabId) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        return { type: 'browser:response', requestId, success: false, error: 'No active tab' };
      }
      targetTabId = tab.id;
    }

    const capture = await captureFullPage(targetTabId);

    return {
      type: 'browser:response',
      requestId,
      success: true,
      data: capture,
    };
  } catch (error) {
    return {
      type: 'browser:response',
      requestId,
      success: false,
      error: error.message || String(error),
    };
  }
}

/**
 * Enhanced save bookmark with full page capture
 * OPT-121: Complete capture with progress feedback and session preservation
 */
async function saveBookmarkWithCapture(url, title, locid = null, tabId = null) {
  const startTime = Date.now();

  try {
    let capture = null;

    // Capture full page if we have a tab
    if (tabId) {
      try {
        // Progress is shown inside captureFullPage
        capture = await captureFullPage(tabId);

        const cookieCount = capture?.cookies?.length || 0;
        const imageCount = capture?.images?.length || 0;
        const screenshotCount = capture?.fullPageScreenshot?.segments?.length || 1;

        console.log(`[AU Archive] Capture complete in ${Date.now() - startTime}ms:`);
        console.log(`  - ${cookieCount} cookies`);
        console.log(`  - ${imageCount} images`);
        console.log(`  - ${screenshotCount} screenshot segments`);
        console.log(`  - ${capture?.localStorage ? 'localStorage' : 'no localStorage'}`);
        console.log(`  - ${capture?.sessionStorage ? 'sessionStorage' : 'no sessionStorage'}`);
      } catch (err) {
        console.error('[AU Archive] Full capture failed:', err.message);
        await setCaptureProgress(tabId, 'ERROR');

        // Fall back to basic screenshot only
        try {
          const screenshot = await chrome.tabs.captureVisibleTab(
            (await chrome.tabs.get(tabId)).windowId,
            { format: 'png' }
          );
          capture = { screenshot };
        } catch (e) {
          capture = null;
        }
      }
    }

    // Stage: Saving to server
    if (tabId) {
      await setCaptureProgress(tabId, 'SAVING');
    }

    const res = await fetch(`${API_BASE}/api/bookmark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        title,
        locid,
        capture, // Full page capture data including cookies, storage, full-page screenshot
      }),
    });

    const data = await res.json();

    // Show final status
    if (tabId) {
      if (data.success) {
        await setCaptureProgress(tabId, 'COMPLETE');
        console.log(`[AU Archive] Archive saved successfully in ${Date.now() - startTime}ms`);

        // Keep success badge visible for 5 seconds so user knows it's safe to navigate
        setTimeout(async () => {
          try {
            await chrome.action.setBadgeText({ text: '', tabId });
          } catch (e) {
            // Tab may have closed
          }
        }, 5000);
      } else {
        await setCaptureProgress(tabId, 'ERROR');
        console.error('[AU Archive] Server save failed:', data.error);
      }
    }

    return data.success;
  } catch (error) {
    console.error('[AU Archive] Failed to save bookmark:', error);
    if (tabId) {
      await setCaptureProgress(tabId, 'ERROR');
    }
    return false;
  }
}
