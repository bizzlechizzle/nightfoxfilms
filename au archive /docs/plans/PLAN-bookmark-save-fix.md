# PLAN: Bookmark Save Error Handling & Diagnostics

**Issue**: "Bookmark was not saved from the browser"
**Date**: 2025-12-14
**Status**: IMPLEMENTED

---

## Problem Analysis

### Current Flow
1. Extension sends POST to `http://localhost:47123/api/bookmark`
2. `bookmark-api-server.ts` handles the request
3. Creates web source in database, queues archive job
4. Returns success/error response
5. Extension shows toast/badge

### Identified Failure Points

| Failure Point | Current Behavior | User Experience |
|---------------|------------------|-----------------|
| API Server failed to start (port 47123 in use) | Logged to console, app continues | Generic "Is app running?" error |
| Network error (fetch fails) | Extension catches, shows generic error | "Failed to save. Is the app running?" |
| HTTP 500 (server error) | Extension shows `data.error` | Shows error message from server |
| Repository not initialized | Returns 500 with specific message | Shows error message |
| Database locked | Request times out or fails | Generic timeout error |

### Root Causes

1. **No UI feedback when server fails to start** (`index.ts:306-308`)
   - Error logged but user never knows the server isn't running

2. **Generic extension error messages** (`sidepanel.js:608-609`, `popup.js:165-166`)
   - All network errors show "Is the app running?" regardless of actual cause

3. **No server status visible in Electron app**
   - User cannot verify if the API server is healthy

---

## Proposed Solution

### Phase 1: Improve Error Visibility (Quick Wins)

#### 1.1 Extension: Show actual error message when server returns one

**File**: `resources/extension/sidepanel.js` (line ~600-610)
**File**: `resources/extension/popup.js` (line ~160-170)

Change from generic "Is the app running?" to showing the actual server error:

```javascript
// Before
} catch (err) {
  showToast('Failed to save. Is the app running?', 'error');
}

// After
} catch (err) {
  if (err.name === 'TimeoutError') {
    showToast('Request timed out. Is the app running?', 'error');
  } else if (err.name === 'TypeError' && err.message.includes('fetch')) {
    showToast('Cannot connect to AU Archive. Is the app running?', 'error');
  } else {
    showToast(`Save failed: ${err.message}`, 'error');
  }
}
```

#### 1.2 Extension: Better HTTP error handling

When server returns non-OK status, show the error body:

```javascript
if (!res.ok) {
  const errorData = await res.json().catch(() => ({}));
  const errorMsg = errorData.error || `Server error: ${res.status}`;
  showToast(errorMsg, 'error');
  return;
}
```

### Phase 2: Server-Side Diagnostics

#### 2.1 Add health check endpoint with detailed status

**File**: `packages/desktop/electron/services/bookmark-api-server.ts`

Enhance `/api/status` to return diagnostic info:

```typescript
// GET /api/status - Enhanced health check
if (method === 'GET' && path === '/api/status') {
  const status = {
    running: true,
    version: '2.0.0',
    repositories: {
      webSources: !!webSourcesRepository,
      locations: !!locationsRepository,
      subLocations: !!subLocationsRepository,
    },
    jobQueue: !!jobQueue,
    uptime: process.uptime(),
  };
  sendJson(res, 200, status);
  return;
}
```

#### 2.2 Add startup notification on server failure

**File**: `packages/desktop/electron/main/index.ts`

When server fails to start, store the error and expose it via IPC:

```typescript
let bookmarkServerError: Error | null = null;

try {
  await startBookmarkAPIServer(...);
} catch (error) {
  bookmarkServerError = error as Error;
  logger.warn('Main', 'Failed to start Bookmark API Server', {...});
  // Emit event for UI notification
  mainWindow?.webContents.send('server:bookmark-api-error', {
    message: (error as Error).message,
  });
}
```

### Phase 3: UI Visibility (Optional)

#### 3.1 Add status indicator in Settings page

Show bookmark API server status in Settings > Debug section:

- Green dot: Server running on port 47123
- Red dot: Server failed to start (with error message)
- Button: "Restart Server" to attempt recovery

---

## Implementation Order

1. **Phase 1.1**: Extension error message improvements (sidepanel.js, popup.js)
2. **Phase 1.2**: HTTP error handling in extension
3. **Phase 2.1**: Enhanced status endpoint
4. **Phase 2.2**: Startup failure notification (optional - requires renderer changes)

---

## Files to Modify

| File | Changes |
|------|---------|
| `resources/extension/sidepanel.js` | Better error messages in catch blocks |
| `resources/extension/popup.js` | Better error messages in catch blocks |
| `resources/extension/background.js` | Better error messages in saveBookmark/saveBookmarkWithCapture |
| `packages/desktop/electron/services/bookmark-api-server.ts` | Enhanced /api/status endpoint |

---

## Testing Plan

1. **Normal save**: Verify bookmark saves successfully
2. **App not running**: Stop app, try to save, verify clear error message
3. **Port conflict**: Start another service on 47123, start app, verify error logged and surfaced
4. **Database error**: Simulate DB error, verify error message shown to user
5. **Network timeout**: Slow down response, verify timeout handling

---

## Rollback

All changes are additive error handling improvements. Rollback by reverting the specific commits if issues arise.

---

---

## Root Cause (Confirmed)

**The bookmark WAS saved to the database.** Investigation confirmed:
```
68e4e6a765701c77 | redfin.com/Red-Creek | Hoarder House | 2025-12-14T17:40:36
```

**The bug:** The Electron renderer UI doesn't receive notifications when bookmarks are saved from the browser extension. The WebSocket broadcasts the `websource_saved` event, but only the extension listens for it - the Svelte UI doesn't.

---

## Implementation (Completed)

### Files Modified

1. **`packages/desktop/electron/services/websocket-server.ts`**
   - Added `BrowserWindow` import from electron
   - Modified `notifyWebSourceSaved()` to also send IPC `websource:saved` to all renderer windows

2. **`packages/desktop/electron/preload/preload.cjs`**
   - Added `onWebSourceSaved` event listener in the `websources` API section
   - Returns cleanup function for proper lifecycle management

3. **`packages/desktop/src/types/electron.d.ts`**
   - Added TypeScript type for `onWebSourceSaved` callback

4. **`packages/desktop/src/components/location/LocationWebSources.svelte`**
   - Added `onMount` with `onWebSourceSaved` listener
   - Auto-refreshes source list when a bookmark is saved to the current location
   - Proper cleanup on component unmount

### Flow After Fix

1. Extension saves bookmark → `POST /api/bookmark`
2. Server creates web source in database
3. Server broadcasts `websource_saved` via WebSocket (for extension)
4. **NEW:** Server sends `websource:saved` via IPC to all Electron windows
5. `LocationWebSources.svelte` receives event
6. If `payload.locid === locid`, calls `loadSources()` to refresh the list
7. UI updates immediately
