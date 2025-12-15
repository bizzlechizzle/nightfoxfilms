/**
 * popup.js
 *
 * Extension popup UI logic for AU Archive Clipper
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
      chrome.action.setBadgeText({ text: '!', tabId: tab.id });
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
      } else {
        recentLocations.innerHTML = '<span class="no-locations">No recent locations</span>';
      }
    } else {
      recentLocations.innerHTML = '<span class="no-locations">No recent bookmarks</span>';
    }
  } catch (error) {
    console.error('Failed to load recent locations:', error);
    recentLocations.innerHTML = '<span class="no-locations">Could not load recent</span>';
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
