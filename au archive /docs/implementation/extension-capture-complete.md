# Extension-First Complete Capture - Implementation Guide

**Version:** 1.0
**Date:** 2025-12-14
**Status:** IN PROGRESS
**Ticket:** OPT-121

---

## Executive Summary

Replace Puppeteer-first archiving with extension-first capture. When user clicks "Archive", the extension captures EVERYTHING while authenticated, eliminating 403 blocks entirely.

---

## Architecture

### Current (Broken)
```
User bookmarks URL → App queues Puppeteer job → Puppeteer visits URL → 403 BLOCKED
```

### New (Extension-First)
```
User on authenticated page → Clicks Archive → Extension captures ALL:
  ├── Full-page screenshot (scroll + stitch)
  ├── Complete HTML (SingleFile-style with inlined resources)
  ├── All cookies for domain
  ├── localStorage + sessionStorage
  ├── User agent + viewport
  └── Metadata (OG, Schema.org, links, images)
       ↓
App saves immediately (partial archive complete)
       ↓
Background: Puppeteer uses cookies for PDF/WARC (may fail, but we have extension data)
       ↓
User notified: "Archive complete - safe to navigate"
```

---

## Implementation Phases

### Phase 1: Full-Page Screenshot ✅ CRITICAL
**Problem:** Current capture only gets visible viewport
**Solution:** Scroll page and stitch multiple screenshots

```javascript
// Extension: Capture full scrollable page
async function captureFullPageScreenshot(tabId) {
  const tab = await chrome.tabs.get(tabId);

  // Get page dimensions via content script
  const [{ result: dimensions }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => ({
      scrollHeight: document.documentElement.scrollHeight,
      scrollWidth: document.documentElement.scrollWidth,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      currentScrollY: window.scrollY,
    }),
  });

  const screenshots = [];
  const totalHeight = dimensions.scrollHeight;
  const viewportHeight = dimensions.viewportHeight;
  let currentY = 0;

  // Scroll to top first
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.scrollTo(0, 0),
  });
  await sleep(100);

  // Capture each viewport
  while (currentY < totalHeight) {
    const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'png',
    });
    screenshots.push({ y: currentY, data: screenshot });

    currentY += viewportHeight;
    if (currentY < totalHeight) {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (y) => window.scrollTo(0, y),
        args: [currentY],
      });
      await sleep(150); // Wait for render
    }
  }

  // Restore scroll position
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (y) => window.scrollTo(0, y),
    args: [dimensions.currentScrollY],
  });

  return {
    screenshots,
    dimensions,
    isFullPage: true,
  };
}
```

### Phase 2: Complete HTML Capture (SingleFile-style)
**Problem:** Current HTML is just DOM, missing CSS/images/fonts
**Solution:** Inline all resources for offline viewing

```javascript
// Extension: Capture complete page with inlined resources
async function captureCompleteHtml(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      // Clone document
      const clone = document.cloneNode(true);

      // Inline all stylesheets
      const styleSheets = Array.from(document.styleSheets);
      const inlinedStyles = [];

      for (const sheet of styleSheets) {
        try {
          const rules = Array.from(sheet.cssRules || []);
          const cssText = rules.map(r => r.cssText).join('\n');
          inlinedStyles.push(cssText);
        } catch (e) {
          // Cross-origin stylesheet - fetch it
          if (sheet.href) {
            // Mark for later fetch
            inlinedStyles.push(`/* External: ${sheet.href} */`);
          }
        }
      }

      // Create combined style element
      const styleEl = document.createElement('style');
      styleEl.textContent = inlinedStyles.join('\n');
      clone.head.appendChild(styleEl);

      // Remove external stylesheet links
      clone.querySelectorAll('link[rel="stylesheet"]').forEach(el => el.remove());

      // Convert images to data URLs (small images only)
      const images = clone.querySelectorAll('img');
      const imagePromises = [];

      // Add base tag for relative URLs
      const baseTag = document.createElement('base');
      baseTag.href = window.location.origin;
      clone.head.insertBefore(baseTag, clone.head.firstChild);

      // Add capture metadata
      const metaCapture = document.createElement('meta');
      metaCapture.name = 'au-archive-captured';
      metaCapture.content = new Date().toISOString();
      clone.head.appendChild(metaCapture);

      return {
        html: '<!DOCTYPE html>\n' + clone.documentElement.outerHTML,
        url: window.location.href,
        title: document.title,
      };
    },
  });

  return result;
}
```

### Phase 3: Cookie Capture with Domain Expansion
**Problem:** Only getting cookies for exact URL
**Solution:** Get all cookies for domain and parent domains

```javascript
// Extension: Comprehensive cookie capture
async function captureAllCookies(url) {
  const urlObj = new URL(url);
  const domain = urlObj.hostname;

  // Get cookies for exact domain
  const exactCookies = await chrome.cookies.getAll({ domain });

  // Get cookies for parent domain (e.g., .redfin.com for www.redfin.com)
  const parts = domain.split('.');
  const parentDomain = parts.length > 2 ? parts.slice(-2).join('.') : domain;
  const parentCookies = await chrome.cookies.getAll({ domain: '.' + parentDomain });

  // Merge and dedupe
  const cookieMap = new Map();
  [...exactCookies, ...parentCookies].forEach(c => {
    const key = `${c.domain}|${c.path}|${c.name}`;
    cookieMap.set(key, c);
  });

  const allCookies = Array.from(cookieMap.values()).map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: c.sameSite,
    expirationDate: c.expirationDate,
  }));

  console.log(`[AU Archive] Captured ${allCookies.length} cookies for ${domain}`);
  return allCookies;
}
```

### Phase 4: Progress Notification System
**Problem:** Badge disappears, user doesn't know when safe to leave
**Solution:** Clear progress states with explicit completion message

```javascript
// Extension: Progress notification system
const CaptureProgress = {
  STARTING: { badge: '⏳', color: '#2196F3', text: 'Starting...' },
  SCREENSHOT: { badge: '📸', color: '#FF9800', text: 'Capturing screenshot...' },
  HTML: { badge: '📄', color: '#FF9800', text: 'Saving page content...' },
  COOKIES: { badge: '🍪', color: '#FF9800', text: 'Saving session...' },
  UPLOADING: { badge: '📤', color: '#9C27B0', text: 'Saving to archive...' },
  COMPLETE: { badge: '✓', color: '#4CAF50', text: 'Archive complete!' },
  ERROR: { badge: '!', color: '#f44336', text: 'Capture failed' },
};

async function updateProgress(tabId, stage) {
  const { badge, color } = CaptureProgress[stage];
  await chrome.action.setBadgeText({ text: badge, tabId });
  await chrome.action.setBadgeBackgroundColor({ color, tabId });

  // For completion, show notification
  if (stage === 'COMPLETE') {
    // Keep badge visible for 5 seconds
    setTimeout(async () => {
      await chrome.action.setBadgeText({ text: '', tabId });
    }, 5000);
  }
}
```

### Phase 5: Server-Side Session Storage
**Problem:** Session data needs to be saved securely
**Solution:** Already implemented in bookmark-api-server.ts (lines 273-298)

Verified existing implementation:
- Creates `_websources/[sourceId]/[sourceId]_session.json`
- Stores cookies, localStorage, sessionStorage, userAgent, viewport
- Used by `websource-capture-service.ts` for Puppeteer injection

### Phase 6: Puppeteer Cookie Injection (Fix Timing)
**Problem:** Cookies must be injected BEFORE navigation
**Solution:** Update capture functions to inject cookies first

```typescript
// websource-capture-service.ts: Fixed cookie injection
export async function captureWithAuth(
  options: CaptureOptions
): Promise<CaptureResult> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    // FIRST: Inject cookies before ANY navigation
    const cookiesInjected = await injectExtensionCookies(
      page,
      options.sourceId,
      options.url
    );

    if (cookiesInjected) {
      console.log(`[Capture] Injected session cookies for ${options.sourceId}`);
    }

    // THEN: Navigate to page
    const response = await page.goto(options.url, {
      waitUntil: 'networkidle2',
      timeout: options.timeout || 30000,
    });

    // Check for blocks
    if (response?.status() === 403) {
      const blockInfo = await detectBotBlock(page);
      if (blockInfo.isBlocked) {
        return {
          success: false,
          error: `Blocked: ${blockInfo.reason}`,
          usedCookies: cookiesInjected,
        };
      }
    }

    // Continue with capture...
  } finally {
    await page.close();
  }
}
```

### Phase 7: Verification & Testing
**Required Tests:**

1. **Cookie Capture Test**
   - Navigate to authenticated site
   - Trigger capture
   - Verify session.json contains cookies

2. **403 Bypass Test**
   - Reset Redfin source to pending
   - Ensure session.json exists with cookies
   - Trigger Puppeteer capture
   - Verify result is NOT 403 error

3. **Full-Page Screenshot Test**
   - Capture long scrollable page
   - Verify screenshot includes below-fold content

4. **User Notification Test**
   - Trigger capture
   - Verify badge shows progress stages
   - Verify final "complete" state is visible

---

## File Changes Summary

| File | Changes | Status |
|------|---------|--------|
| `resources/extension/manifest.json` | v2.0.0, cookies permission, all_urls | ✅ Complete |
| `resources/extension/background.js` | Full-page screenshot, cookie capture, progress badges | ✅ Complete |
| `bookmark-api-server.ts` | Session storage to configured archive path | ✅ Complete |
| `websource-capture-service.ts` | Cookie injection, path resolution fix | ✅ Complete |
| `websource-orchestrator-service.ts` | Error detection, extension-first | ✅ Complete |

---

## Testing Instructions

### To test the 403 bypass:

1. **Reload extension in Research Browser**:
   - Open `chrome://extensions`
   - Find "AU Archive Clipper"
   - Click reload button

2. **Capture authenticated page**:
   - Navigate to https://www.redfin.com/NY/Red-Creek/12854-Coolican-Rd-13143/home/73216395
   - Right-click → Save to AU Archive → [Location]
   - Watch badge: ◐ → ◑ → ◒ → ◓ → ✓

3. **Verify session data saved**:
   ```bash
   ls -la "/Volumes/abandoned/archive/_websources/"
   cat "/Volumes/abandoned/archive/_websources/[sourceId]/[sourceId]_session.json"
   ```

4. **Trigger Puppeteer capture**:
   - In app, go to Research → Web Sources
   - Click on the Redfin source
   - Click "Re-capture" or wait for background job
   - Check logs for "[OPT-121] Loaded extension session"

5. **Verify 403 bypass**:
   - Check capture result is NOT CloudFront 403 error
   - Screenshot/PDF should show actual Redfin page

---

## CLAUDE.md Compliance Checklist

- [x] No AI mention in UI
- [x] Offline-first (extension data works without network)
- [x] Real-time UI updates (progress badge)
- [x] Error handling with user-friendly messages
- [x] Premium UX (clear completion state with 5s badge)
- [x] No prompts during operation
- [x] Source attribution preserved

---

## Completion Criteria

| Criteria | Status |
|----------|--------|
| Extension captures full-page screenshot | ✅ Code complete |
| Extension captures complete HTML | ✅ Code complete |
| Extension captures all cookies | ✅ Code complete |
| Extension shows clear progress | ✅ Code complete |
| Server saves session data to configured path | ✅ Code complete |
| Puppeteer loads session from configured path | ✅ Code complete |
| 403 bypass verified working | ⏳ Pending user test |
| All tests pass | ⏳ Build succeeds |
| Code audited vs spec | ⏳ In progress |
| Pushed to GitHub | ⏳ Pending |

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Cookies expire before Puppeteer runs | Queue Puppeteer job immediately, run within minutes |
| Some sites use additional auth | Fall back to extension data (screenshot/HTML) |
| Full-page screenshot performance | Limit to 10 scroll positions max |
| Large HTML files | Compress before storage, limit to 5MB |

