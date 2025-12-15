/**
 * sidepanel.js
 *
 * AU Archive Side Panel - Main logic for persistent bookmark panel
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

// DOM Elements cache
const elements = {};

/**
 * Initialize the side panel
 */
async function init() {
  // Cache DOM elements
  cacheElements();

  // Set up event listeners
  setupEventListeners();

  // Ensure form is hidden and reset on init
  if (elements.newLocationForm) {
    elements.newLocationForm.hidden = true;
  }
  if (elements.toggleNewLocation) {
    elements.toggleNewLocation.classList.remove('active');
  }

  // Check API status
  const online = await checkApiStatus();
  updateConnectionStatus(online ? 'online' : 'offline');

  if (online) {
    // Connect WebSocket for real-time updates
    connectWebSocket();

    // Load initial data
    await loadRecentLocations();
    await loadCurrentTab();
  } else {
    elements.recentLocations.innerHTML =
      '<div class="loading">AU Archive app is not running</div>';
  }
}

/**
 * Cache DOM element references for performance
 */
function cacheElements() {
  elements.statusDot = document.getElementById('status-dot');
  elements.statusText = document.getElementById('status-text');
  elements.searchInput = document.getElementById('search-input');
  elements.searchResults = document.getElementById('search-results');
  elements.recentLocations = document.getElementById('recent-locations');
  elements.toggleNewLocation = document.getElementById('toggle-new-location');
  elements.newLocationSection = document.getElementById('new-location-section');
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
  elements.saveBtnText = elements.saveBtn?.querySelector('.btn-text');
  elements.saveBtnLoading = elements.saveBtn?.querySelector('.btn-loading');
  elements.sessionHistory = document.getElementById('session-history');
  elements.toast = document.getElementById('toast');
  elements.toastMessage = document.getElementById('toast-message');
}

/**
 * Set up all event listeners
 */
function setupEventListeners() {
  // Search input
  elements.searchInput.addEventListener('input', handleSearchInput);
  elements.searchInput.addEventListener('keydown', handleSearchKeydown);

  // Close search results when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container')) {
      elements.searchResults.classList.remove('show');
    }
  });

  // New location form toggle
  elements.toggleNewLocation.addEventListener('click', toggleNewLocationForm);

  // Create location
  elements.createLocationBtn.addEventListener('click', handleCreateLocation);

  // Clear location selection
  elements.clearSelection.addEventListener('click', clearSelection);

  // Save bookmark to selected location
  elements.saveBtn.addEventListener('click', handleSaveBookmark);

  // Keyboard shortcut: Ctrl+Enter to save
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSaveBookmark();
    }
  });
}

/**
 * Check if the AU Archive API is running
 */
async function checkApiStatus() {
  try {
    const res = await fetch(`${API_BASE}/api/status`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Update the connection status indicator
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
 * Connect to WebSocket server for real-time updates
 */
function connectWebSocket() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    return;
  }

  updateConnectionStatus('connecting');

  try {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('[AU Archive] WebSocket connected');
      updateConnectionStatus('online');

      // Subscribe to updates
      ws.send(JSON.stringify({ type: 'subscribe' }));

      // Clear any pending reconnect
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
        console.error('[AU Archive] Invalid WebSocket message:', err);
      }
    };

    ws.onclose = () => {
      console.log('[AU Archive] WebSocket disconnected');
      updateConnectionStatus('offline');
      scheduleReconnect();
    };

    ws.onerror = (err) => {
      console.error('[AU Archive] WebSocket error:', err);
      updateConnectionStatus('offline');
    };
  } catch (err) {
    console.error('[AU Archive] WebSocket connection failed:', err);
    updateConnectionStatus('offline');
    scheduleReconnect();
  }
}

/**
 * Schedule WebSocket reconnection with exponential backoff
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
      // Refresh the location list when locations change in the app
      loadRecentLocations();
      break;

    case 'bookmark_saved':
      // Confirmation that bookmark was saved (could show additional UI)
      break;

    case 'ping':
      // Respond to server heartbeat
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
      break;

    default:
      console.log('[AU Archive] Unknown message type:', message.type);
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
    console.error('[AU Archive] Failed to load locations:', err);
    elements.recentLocations.innerHTML =
      '<div class="loading">Failed to load locations</div>';
  }
}

/**
 * Render the location list
 */
function renderLocationList(locations) {
  elements.recentLocations.innerHTML = locations.map(loc => `
    <div class="location-item ${selectedLocation?.locid === loc.locid ? 'selected' : ''}"
         data-locid="${loc.locid}"
         data-name="${escapeHtml(loc.locnam)}"
         data-type="location">
      <span class="name">${escapeHtml(loc.locnam)}</span>
      ${loc.address_state ? `<span class="state">${escapeHtml(loc.address_state)}</span>` : ''}
    </div>
  `).join('');

  // Add click handlers to location items
  elements.recentLocations.querySelectorAll('.location-item').forEach(item => {
    item.addEventListener('click', () => selectLocation({
      locid: item.dataset.locid,
      locnam: item.dataset.name
    }));
  });
}

/**
 * Handle search input with debouncing
 */
function handleSearchInput(e) {
  const query = e.target.value.trim();

  // Clear previous timeout
  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }

  // Hide results if query is empty
  if (!query) {
    elements.searchResults.classList.remove('show');
    // Also hide New Location section when search is cleared
    if (elements.newLocationSection) {
      elements.newLocationSection.hidden = true;
    }
    return;
  }

  // Debounce search request
  searchTimeout = setTimeout(() => searchLocations(query), 300);
}

/**
 * Handle keyboard navigation in search
 */
function handleSearchKeydown(e) {
  if (e.key === 'Escape') {
    elements.searchResults.classList.remove('show');
    elements.searchInput.blur();
  }
}

/**
 * Search locations and sub-locations via unified API
 */
async function searchLocations(query) {
  try {
    const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();

    if (data.results && data.results.length > 0) {
      renderSearchResults(data.results);
      // Hide New Location section when we have results
      if (elements.newLocationSection) {
        elements.newLocationSection.hidden = true;
      }
    } else {
      // Show "no matches" message and reveal New Location button
      elements.searchResults.innerHTML = `
        <div class="search-result-item no-results">
          <span class="name">No matches found</span>
        </div>
      `;
      // Show New Location section when search returns empty
      if (elements.newLocationSection) {
        elements.newLocationSection.hidden = false;
      }
    }
    elements.searchResults.classList.add('show');
  } catch (err) {
    console.error('[AU Archive] Search failed:', err);
    elements.searchResults.classList.remove('show');
  }
}

/**
 * Render search results dropdown (locations and sub-locations)
 */
function renderSearchResults(results) {
  elements.searchResults.innerHTML = results.map(item => {
    if (item.type === 'sublocation') {
      // Sub-location: show name with parent location indicator
      return `
        <div class="search-result-item sublocation"
             data-locid="${item.locid}"
             data-subid="${item.subid}"
             data-name="${escapeHtml(item.name)}"
             data-parent="${escapeHtml(item.parentName)}">
          <span class="name">${escapeHtml(item.name)}</span>
          <span class="parent">${escapeHtml(item.parentName)}</span>
        </div>
      `;
    } else {
      // Location
      return `
        <div class="search-result-item"
             data-locid="${item.locid}"
             data-name="${escapeHtml(item.name)}">
          <span class="name">${escapeHtml(item.name)}</span>
          ${item.address_state ? `<span class="state">${escapeHtml(item.address_state)}</span>` : ''}
        </div>
      `;
    }
  }).join('');

  // Add click handlers to search results
  elements.searchResults.querySelectorAll('.search-result-item').forEach(item => {
    if (item.classList.contains('no-results') || item.classList.contains('create-new')) return;

    item.addEventListener('click', () => {
      const isSubLocation = item.classList.contains('sublocation');
      selectLocation({
        locid: item.dataset.locid,
        subid: isSubLocation ? item.dataset.subid : null,
        locnam: isSubLocation
          ? `${item.dataset.name} (${item.dataset.parent})`
          : item.dataset.name
      });
      elements.searchInput.value = '';
      elements.searchResults.classList.remove('show');
    });
  });
}

/**
 * Select a location for saving
 */
function selectLocation(location) {
  selectedLocation = location;

  // Update UI to show selection
  elements.selectedName.textContent = location.locnam;
  elements.selectedName.classList.remove('placeholder');
  elements.clearSelection.hidden = false;
  elements.saveBtn.disabled = false;

  // Highlight selected location in list
  elements.recentLocations.querySelectorAll('.location-item').forEach(item => {
    item.classList.toggle('selected', item.dataset.locid === location.locid);
  });
}

/**
 * Clear the current location selection
 */
function clearSelection() {
  selectedLocation = null;

  elements.selectedName.textContent = 'Select a location';
  elements.selectedName.classList.add('placeholder');
  elements.clearSelection.hidden = true;
  elements.saveBtn.disabled = true;

  // Remove selection highlight from list
  elements.recentLocations.querySelectorAll('.location-item').forEach(item => {
    item.classList.remove('selected');
  });
}

/**
 * Toggle the new location form visibility
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
 * Handle creating a new location
 */
async function handleCreateLocation() {
  const name = elements.newLocName.value.trim();
  const state = elements.newLocState.value.trim().toUpperCase();
  const type = elements.newLocType.value;

  if (!name) {
    showToast('Please enter a location name', 'error');
    elements.newLocName.focus();
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

      // Auto-select the new location
      selectLocation({
        locid: data.locid,
        locnam: data.locnam
      });

      // Clear and close form
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
    console.error('[AU Archive] Create location failed:', err);
    showToast('Failed to create location. Is the app running?', 'error');
  } finally {
    elements.createLocationBtn.disabled = false;
    elements.createLocationBtn.textContent = 'Create Location';
  }
}

/**
 * Load current tab information
 */
async function loadCurrentTab() {
  try {
    // Query the active tab in the current window
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab && tab.url) {
      currentTab = tab;
      // Use title if available, otherwise extract from URL
      let title = tab.title;
      if (!title || title === '' || title === tab.url) {
        try {
          const url = new URL(tab.url);
          title = url.hostname + url.pathname;
        } catch {
          title = tab.url.substring(0, 50);
        }
      }
      elements.pageTitle.textContent = title;
      elements.pageUrl.textContent = tab.url || '';
    } else {
      // No valid tab found
      elements.pageTitle.textContent = 'No page loaded';
      elements.pageUrl.textContent = '';
    }
  } catch (err) {
    console.error('[AU Archive] Failed to get current tab:', err);
    elements.pageTitle.textContent = 'Unable to get page info';
    elements.pageUrl.textContent = '';
  }
}

/**
 * Restore save button to normal state
 */
function resetSaveButton() {
  if (elements.saveBtn) {
    elements.saveBtn.disabled = !selectedLocation;
  }
  if (elements.saveBtnText) {
    elements.saveBtnText.hidden = false;
  }
  if (elements.saveBtnLoading) {
    elements.saveBtnLoading.hidden = true;
  }
}

/**
 * Handle saving a bookmark to the selected location or sub-location
 */
async function handleSaveBookmark() {
  if (!currentTab || !currentTab.url) {
    showToast('No page to save', 'error');
    return;
  }

  if (!selectedLocation) {
    showToast('Please select a location first', 'error');
    return;
  }

  // Show loading state
  elements.saveBtn.disabled = true;
  if (elements.saveBtnText) elements.saveBtnText.hidden = true;
  if (elements.saveBtnLoading) elements.saveBtnLoading.hidden = false;

  try {
    const res = await fetch(`${API_BASE}/api/bookmark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000), // 10 second timeout
      body: JSON.stringify({
        url: currentTab.url,
        title: currentTab.title || '',
        locid: selectedLocation.locid,
        subid: selectedLocation.subid || null
      })
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();

    if (data.success) {
      showToast(`Saved to ${selectedLocation.locnam}`, 'success');
      // Add to session history
      addToSessionHistory(currentTab.url, selectedLocation.locnam);
    } else {
      showToast(data.error || 'Failed to save bookmark', 'error');
    }
  } catch (err) {
    console.error('[AU Archive] Save bookmark failed:', err);
    if (err.name === 'TimeoutError') {
      showToast('Request timed out. Is the app running?', 'error');
    } else {
      showToast('Failed to save. Is the app running?', 'error');
    }
  }

  // Always restore button state (outside try/catch to guarantee execution)
  resetSaveButton();
}

/**
 * Add a saved bookmark to session history
 */
function addToSessionHistory(url, locationName) {
  // Add to beginning of array
  sessionHistory.unshift({
    url,
    locationName,
    timestamp: Date.now()
  });

  // Keep only last 10 items
  sessionHistory = sessionHistory.slice(0, 10);

  renderSessionHistory();
}

/**
 * Render the session history list
 */
function renderSessionHistory() {
  if (sessionHistory.length === 0) {
    elements.sessionHistory.innerHTML =
      '<div class="history-empty">No bookmarks saved this session</div>';
    return;
  }

  elements.sessionHistory.innerHTML = sessionHistory.map(item => {
    let displayUrl;
    try {
      displayUrl = new URL(item.url).hostname;
    } catch {
      displayUrl = item.url.substring(0, 30);
    }

    return `
      <div class="history-item">
        <span class="url" title="${escapeHtml(item.url)}">${escapeHtml(displayUrl)}</span>
        <span class="loc">${escapeHtml(item.locationName)}</span>
      </div>
    `;
  }).join('');
}

/**
 * Show a toast notification
 */
function showToast(message, type = 'info') {
  elements.toastMessage.textContent = message;
  elements.toast.className = `toast ${type}`;
  elements.toast.hidden = false;

  // Auto-hide after 3 seconds
  setTimeout(() => {
    elements.toast.hidden = true;
  }, 3000);
}

/**
 * Escape HTML to prevent XSS attacks
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

// Listen for tab activation changes
chrome.tabs.onActivated.addListener(() => {
  loadCurrentTab();
});

// Listen for tab URL/title updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // Refresh when URL changes or page finishes loading or title changes
  if (changeInfo.url || changeInfo.status === 'complete' || changeInfo.title) {
    loadCurrentTab();
  }
});

// Refresh tab info when side panel gains focus
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    loadCurrentTab();
  }
});

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
