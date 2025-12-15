# ADR-047: Zero-Detection Research Browser Architecture

**Status:** Implemented
**Date:** 2025-12-12
**Author:** Development Team

---

## Context

The Research Browser feature was being flagged by bot detection systems (Cloudflare, Akamai, PerimeterX) when using websites for research. The original implementation used `puppeteer-core` to control an Ungoogled Chromium browser, which left detectable automation fingerprints.

### Root Causes of Detection

| Detection Vector | Original Status | Impact |
|-----------------|----------------|--------|
| `navigator.webdriver = true` | Exposed | **CRITICAL** - Primary bot signal |
| CDP artifacts (`cdc_` vars) | Present | High - DevTools Protocol detection |
| Client Hints (`sec-ch-ua`) | Automation pattern | High - Cloudflare checks |
| TLS fingerprint | Puppeteer pattern | High - Network-level detection |
| Process tree | Child of Electron | Medium |

---

## Decision

Replace the puppeteer-controlled browser with a **detached native process** that communicates exclusively through the browser extension + WebSocket infrastructure.

### Key Principles

1. **No CDP Connection** - Browser runs independently, no DevTools Protocol
2. **Extension-Only Communication** - Commands flow through WebSocket to extension
3. **Process Independence** - Browser can outlive the main app
4. **Zero Automation Artifacts** - Browser behaves exactly like user-launched

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AU Archive Desktop                            │
│                                                                      │
│  ┌──────────────────┐    ┌──────────────────┐    ┌───────────────┐ │
│  │  Main Process    │    │  HTTP API        │    │  WebSocket    │ │
│  │                  │    │  :47123          │    │  Server :47124│ │
│  │  spawn()         │    │                  │    │               │ │
│  │  (no CDP)        │    │  /api/bookmark   │    │  Commands ↔   │ │
│  └────────┬─────────┘    └──────────────────┘    └───────┬───────┘ │
│           │                                              │         │
└───────────┼──────────────────────────────────────────────┼─────────┘
            │ spawn()                                      │ WebSocket
            │ (detached)                                   │
            ▼                                              ▼
┌────────────────────────────────────────────────────────────────────┐
│         Ungoogled Chromium (Detached Process)                      │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │      AU Archive Clipper Extension (background.js)            │ │
│  │                                                              │ │
│  │  - Receives browser:command messages                         │ │
│  │  - Executes via chrome.tabs.* APIs                          │ │
│  │  - Sends browser:response back                               │ │
│  │  - Reports browser:event for state changes                  │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  navigator.webdriver = undefined  ✓                                │
│  No CDP connection                ✓                                │
│  User-launched behavior           ✓                                │
└────────────────────────────────────────────────────────────────────┘
```

---

## Implementation

### Files Created/Modified

| File | Action | Purpose |
|------|--------|---------|
| `electron/services/detached-browser-service.ts` | CREATE | Spawn-based browser launcher |
| `electron/services/browser-command-service.ts` | CREATE | WebSocket command routing |
| `electron/services/websocket-server.ts` | MODIFY | Browser command handling |
| `electron/main/ipc-handlers/research-browser.ts` | MODIFY | Use new services |
| `electron/main/index.ts` | MODIFY | Import new service |
| `resources/extension/background.js` | MODIFY | Command handlers |
| `resources/extension/manifest.json` | MODIFY | WebSocket permission |
| `electron/services/research-browser-service.ts` | DELETE | Removed puppeteer version |
| `package.json` | MODIFY | Remove puppeteer-core |

### Communication Protocol

#### Main App → Extension (Commands)

```typescript
interface BrowserCommand {
  type: 'browser:command';
  requestId: string;
  command:
    | { action: 'navigate'; url: string }
    | { action: 'newTab'; url?: string }
    | { action: 'closeTab'; tabId?: number }
    | { action: 'screenshot' }
    | { action: 'getActiveTab' }
    | { action: 'getTabs' }
    | { action: 'focusTab'; tabId: number }
    | { action: 'ping' };
}
```

#### Extension → Main App (Responses)

```typescript
interface BrowserResponse {
  type: 'browser:response';
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: string;
}
```

#### Extension → Main App (Events)

```typescript
interface BrowserEvent {
  type: 'browser:event';
  event:
    | { name: 'tabActivated'; tabId: number; url: string; title: string }
    | { name: 'tabUpdated'; tabId: number; url: string; title: string }
    | { name: 'tabClosed'; tabId: number }
    | { name: 'extensionReady' }
    | { name: 'heartbeat' };
}
```

---

## IPC Channels

| Channel | Parameters | Returns | Description |
|---------|------------|---------|-------------|
| `research:launch` | none | `{ success, pid?, error? }` | Launch browser |
| `research:close` | none | `{ success, error? }` | Terminate browser |
| `research:status` | none | `BrowserStatus` | Get status |
| `research:navigate` | `url: string` | `{ success }` | Navigate active tab |
| `research:newTab` | `url?: string` | `{ success, tabId? }` | Open new tab |
| `research:getActiveTab` | none | `{ success, tab }` | Get active tab info |
| `research:getTabs` | none | `{ success, tabs }` | Get all tabs |
| `research:screenshot` | none | `{ success, dataUrl }` | Capture screenshot |
| `research:ping` | none | `{ success, connected }` | Check extension |

---

## Detection Comparison

| Vector | Before (puppeteer) | After (detached) |
|--------|-------------------|------------------|
| `navigator.webdriver` | `true` ❌ | `undefined` ✅ |
| CDP artifacts | Present ❌ | None ✅ |
| TLS fingerprint | Puppeteer pattern ❌ | Native Chrome ✅ |
| HTTP/2 fingerprint | Automation ❌ | Native ✅ |
| Process tree | Child of Electron | Independent ✅ |
| DevTools Protocol | Connected ❌ | Not connected ✅ |

---

## Tradeoffs

### Gains

- Zero bot detection fingerprint
- Browser behaves exactly like user-launched
- Profile persistence works normally
- Extensions work without quirks
- Can survive main app restart

### Losses

- No synchronous page manipulation
- Cannot inject JavaScript directly
- Screenshot requires extension API (slightly slower)
- Commands are async with network latency
- Harder to debug automation issues

---

## Testing

### Manual Testing

1. Launch Research Browser from app
2. Visit https://bot.sannysoft.com/
3. Verify "webdriver" shows as "missing" (not "true")
4. Visit Cloudflare-protected site
5. Verify no bot challenge appears

### Bot Detection Test Sites

- https://bot.sannysoft.com/
- https://arh.antoinevastel.com/bots/areyouheadless
- https://pixelscan.net/

---

## Usage Example

```typescript
// Launch browser
const result = await window.electron.research.launch();
if (result.success) {
  console.log('Browser launched, PID:', result.pid);
}

// Check status
const status = await window.electron.research.status();
console.log('Running:', status.running);
console.log('Extension connected:', status.extensionConnected);

// Navigate (requires extension connection)
await window.electron.research.navigate('https://example.com');

// Get current tab
const tabResult = await window.electron.research.getActiveTab();
console.log('Current URL:', tabResult.tab?.url);
```

---

## Consequences

1. The Research Browser no longer triggers bot detection
2. Remote control is limited to what the extension API supports
3. Browser process is independent and must be explicitly terminated
4. Extension must be connected for command features to work
5. Dependencies reduced (no more puppeteer-core)

---

## References

- Bot detection mechanisms: https://github.com/AlessandroZ/BeRoot/
- Puppeteer stealth approaches: https://github.com/AlessandroZ/puppeteer-extra-plugin-stealth
- Chrome DevTools Protocol detection: https://antoinevastel.com/bot%20detection/2018/01/17/detect-chrome-headless-v2.html
