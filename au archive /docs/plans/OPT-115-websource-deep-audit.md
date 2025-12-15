# OPT-115: Web Source Deep Audit - "Use the Same Browser"

**Status**: COMPLETE ✅
**Created**: 2025-12-12
**Completed**: 2025-12-12
**Commit**: e28669f
**Author**: Claude Code
**Severity**: HIGH - User workflow fundamentally broken

---

## IMPLEMENTATION SUMMARY

All phases implemented:

### Phase 1: Extension-First Capture
- **`resources/extension/background.js`**: Added `captureFullPage()`, `extractPageContent()`, `handleCapturePageCommand()`, `saveBookmarkWithCapture()`
- **`resources/extension/manifest.json`**: Added `scripting` permission
- **Extension captures**: Screenshot, HTML, DOM metadata, links, images with full context

### Phase 2: Database & Storage
- **Migration 71**: Added capture tracking columns (capture_method, extension_captured_at, puppeteer_captured_at, og_title, og_description, og_image, twitter_card_json, schema_org_json, http_status)
- **`database.types.ts`**: Updated WebSourcesTable interface
- **`sqlite-websources-repository.ts`**: Updated WebSource and WebSourceUpdate interfaces, enhanced updatePageMetadata()

### Phase 3: API & Processing
- **`bookmark-api-server.ts`**: Added `processExtensionCapture()` function, handles full capture data from extension

### Phase 4: UI Enhancements
- **`WebSourceDetailModal.svelte`**: Added Open Graph preview, Twitter Card display, Schema.org viewer, Capture Info section

### Phase 5: Text Extraction
- **`scripts/extract-text.py`**: Multi-strategy extraction using Trafilatura, BeautifulSoup, Readability

---

## EXECUTIVE SUMMARY

The web archiving system has a **fundamental architectural mismatch** between how the Research Browser works and how the capture service works. The user's core complaint:

> "at some point all of this was working flawlessly - why are we still having cache issues? Use the same browser as the user open if you have to"

**Root cause**: We are NOT using the same browser. We're launching a SECOND browser.

---

## THE FUNDAMENTAL PROBLEM

### Current Architecture (Broken)

```
┌─────────────────────────────────────────────────────────────────────┐
│ USER WORKFLOW                                                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. User opens Research Browser                                      │
│     └─ detached-browser-service.ts spawns Chromium                   │
│     └─ NO CDP connection (zero automation fingerprint)               │
│     └─ Profile: ~/Library/Application Support/au-archive/research-browser/
│                                                                      │
│  2. User logs into Zillow, gets cookies                              │
│     └─ Cookies saved to profile directory                            │
│     └─ PerimeterX sees real human                                    │
│                                                                      │
│  3. User saves bookmark                                              │
│     └─ Extension sends URL to main process                           │
│     └─ Source created with status='pending'                          │
│                                                                      │
│  4. Auto-archive triggers                                            │
│     └─ BUT: Research Browser profile is LOCKED (browser is running!) │
│     └─ Falls back to EMPTY browser-profile/ directory                │
│     └─ NO COOKIES = bot detection = CAPTCHA page                     │
│                                                                      │
│  5. User closes Research Browser                                     │
│     └─ Profile unlocked                                              │
│     └─ Manual re-archive MIGHT work                                  │
│     └─ BUT: Puppeteer launches NEW browser, copies profile           │
│     └─ Cookie jar may not be read correctly                          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### The Two Browser Problem

| Component | Browser | CDP Connection | Cookies |
|-----------|---------|----------------|---------|
| Research Browser | Detached Chromium | **NONE** (zero-detection) | User's real cookies |
| Capture Service | Puppeteer-launched Chromium | **YES** (automation) | Copied/empty profile |

**These are DIFFERENT browser instances with DIFFERENT sessions!**

---

## COMMIT ARCHAEOLOGY

Looking at the commit history, I can trace the evolution:

| Commit | Change | Impact |
|--------|--------|--------|
| `68aa629` (ADR-047) | Added zero-detection Research Browser | Created the split: manual browser vs automation |
| `60c7e22` (OPT-112) | Added stealth plugin + "Research Browser cookies" | **Claimed to fix cookies but pointed to WRONG path** |
| `0cf0faf` (OPT-114) | Lazy-load stealth plugin | Minor fix |
| `36b41b6` (OPT-114) | Fixed profile path mismatch | Corrected path BUT fundamental architecture unchanged |

**Key insight**: OPT-114 fixed the PATH but not the ARCHITECTURE. Even with the correct path:
1. If browser is running → profile locked → fallback profile → no cookies
2. If browser is closed → Puppeteer launches new instance → may not inherit cookies correctly

---

## DETAILED FINDINGS

### Finding #1: Profile Lock Always Triggers When User Expects It To Work

**When does user save bookmarks?** When browsing in Research Browser.
**When is Research Browser profile locked?** When Research Browser is running.
**Result:** Auto-archive ALWAYS falls back to empty profile.

**Code location**: `websource-capture-service.ts:201-214`

```typescript
export function isProfileLocked(profilePath: string): boolean {
  const lockFiles = [
    path.join(profilePath, 'SingletonLock'),  // Linux/macOS
    path.join(profilePath, 'lockfile'),
    path.join(profilePath, 'Local State.lock'),
  ];
  // If ANY lock file exists, we use fallback profile
}
```

**This is working as designed but the design is wrong for the user's workflow.**

### Finding #2: Puppeteer Cookie Handling May Be Broken

Even when profile is NOT locked, Puppeteer's cookie handling with `userDataDir` is unreliable:

1. **Chrome profile format mismatch**: Puppeteer may not read all cookie types
2. **Session cookies**: May not persist across browser launches
3. **Encrypted cookies**: Some platforms encrypt cookies in ways Puppeteer can't read
4. **Cookie SameSite issues**: Modern cookie restrictions

**No verification exists** that cookies are actually being used.

### Finding #3: Multiple Browser Instances = Multiple Sessions

Each `captureScreenshot()`, `capturePdf()`, `captureHtml()`, `captureWarc()` call:
1. Calls `getBrowser()` → gets shared instance
2. Opens new page
3. Navigates to URL
4. **Each navigation is a FRESH request**

The browser instance is shared, but each capture is a separate page load. If site uses:
- Rate limiting
- Request fingerprinting
- Session tracking

...they see MULTIPLE requests from an automated browser, not the user's ongoing session.

### Finding #4: No Cookie Verification or Debugging

There's no way to verify:
- Are cookies being loaded?
- Which cookies exist?
- Did the site accept the session?

**No logging of cookie state before/after capture.**

---

## BEST PRACTICES COMPARISON

### How Professional Tools Solve This

| Tool | Approach | Pros | Cons |
|------|----------|------|------|
| **SingleFile** | Browser extension captures current page | Perfect fidelity, user's exact session | Extension-only, limited formats |
| **ArchiveBox** | Uses Playwright with explicit cookie import | Works for logged-in sites | Requires manual cookie export |
| **Browserless.io** | Persistent browser contexts | Maintains session across requests | Cloud-based, not local |
| **Playwright** | `storageState` API | Clean cookie import/export | Requires explicit handling |

### The Right Approach: Extension-First Capture

The Research Browser ALREADY has an extension (AU Archive Clipper). The extension CAN:
1. Access the current page's DOM
2. Screenshot the current viewport
3. Send data to main process via WebSocket

**This bypasses the two-browser problem entirely.**

---

## PROPOSED SOLUTIONS

### Option A: Extension-First Capture (RECOMMENDED)

**Architecture**:
```
User in Research Browser → Clicks "Archive" in extension
                              ↓
                     Extension captures from CURRENT PAGE:
                     - DOM snapshot (single-file HTML)
                     - Screenshot (canvas/viewport)
                     - Current URL state
                              ↓
                     Sends to main process via WebSocket
                              ↓
                     Main process saves files, extracts metadata
```

**Pros**:
- Uses user's exact session
- No second browser needed
- Zero bot detection risk
- Instant capture (page already loaded)

**Cons**:
- PDF generation may need separate approach
- WARC format harder from extension
- Requires extension code changes

**Estimated effort**: Medium (40-60 LOC extension, 100-150 LOC main process)

### Option B: CDP Bridge to Running Browser

**Architecture**:
```
User running Research Browser
              ↓
When archive needed:
1. Enable remote debugging port (requires restart)
2. OR use extension to inject CDP-like capabilities
3. Connect Puppeteer to EXISTING browser
4. Perform captures on existing session
5. Disconnect
```

**Pros**:
- Uses exact same browser session
- All formats supported (PDF, WARC)

**Cons**:
- Requires browser restart or complex injection
- May introduce automation fingerprints
- Complex to implement

**Estimated effort**: High

### Option C: Perfect Cookie Migration

**Architecture**:
```
Research Browser saves cookies to profile
              ↓
On archive trigger:
1. Read cookies directly from SQLite (Cookies file)
2. Decrypt if needed (macOS Keychain)
3. Inject into Puppeteer via CDP
4. Perform capture
```

**Pros**:
- Works with current architecture
- Minimal UI changes

**Cons**:
- Cookie decryption is platform-specific
- Session cookies may not persist
- Still uses separate browser (bot detection risk)

**Estimated effort**: Medium-High

### Option D: Hybrid Approach (RECOMMENDED FIRST STEP)

**Phase 1**: Fix immediate pain points
- Add cookie verification logging
- Fix profile lock issue with queue delay
- Add "Browser must be closed" UI feedback

**Phase 2**: Extension-first for HTML/Screenshot
- Extension captures current page state
- Main process handles archival storage

**Phase 3**: Puppeteer for PDF/WARC only
- Use Puppeteer only when necessary
- Improve cookie handling

---

## IMMEDIATE FIXES NEEDED

### Fix 1: Add Cookie Debugging

**Before ANY capture**, log cookie state:

```typescript
// In websource-capture-service.ts, before navigation
const cookies = await page.cookies();
console.log(`[WebSource] Loaded ${cookies.length} cookies for ${new URL(url).hostname}`);
console.log(`[WebSource] Cookie domains: ${[...new Set(cookies.map(c => c.domain))].join(', ')}`);
```

### Fix 2: Queue Archive Jobs for Later

When profile is locked, don't fallback - queue for later:

```typescript
if (isProfileLocked(profilePath)) {
  console.log('[WebSource] Profile locked - queuing for later');
  // Return pending status, don't attempt with empty profile
  throw new Error('PROFILE_LOCKED: Will retry when Research Browser is closed');
}
```

### Fix 3: UI Feedback on Profile Lock

Show user why archive is pending:

```
⏳ Waiting to archive - Close Research Browser to continue
```

### Fix 4: Extension Capture for Critical Data

For HTML/Screenshot, use extension's direct access:

```javascript
// In extension content script
function captureCurrentPage() {
  return {
    html: document.documentElement.outerHTML,
    title: document.title,
    url: window.location.href,
    // Screenshot via canvas
  };
}
```

---

## TESTING PLAN

### Test 1: Cookie Verification
1. Log into Zillow in Research Browser
2. Close Research Browser
3. Trigger archive
4. **CHECK**: Are Zillow cookies in the log?

### Test 2: Profile Lock Behavior
1. Open Research Browser
2. Save bookmark
3. **CHECK**: Does archive show "waiting for browser close"?

### Test 3: Successful Archive
1. Log into Zillow
2. Close Research Browser
3. Trigger archive
4. **CHECK**: Full content (not CAPTCHA)?

---

## QUESTIONS FOR USER

1. **Extension-first capture**: Would you accept extension capturing HTML/Screenshot directly, with Puppeteer only for PDF/WARC?

2. **Queue vs fallback**: Should we queue archives until browser closes, or attempt with fallback profile?

3. **Scope**: Is this audit covering just cookies, or full websource pipeline review?

---

## FILES TO MODIFY

| File | Changes |
|------|---------|
| `websource-capture-service.ts` | Cookie logging, profile lock handling |
| `websources.ts` (IPC) | Queue vs fallback logic |
| `extension/content.js` | Direct page capture |
| `extension/background.js` | WebSocket send to main |
| UI components | Profile lock status display |

---

## RISK ASSESSMENT

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Extension capture incomplete | Medium | Medium | Puppeteer fallback for PDF/WARC |
| Cookie decryption fails | High | High | Use extension-first approach |
| Bot detection persists | Medium | High | Extension captures avoid this entirely |
| User confusion about flow | Low | Low | Clear UI status messages |

---

## RECOMMENDATION

**Implement in this order**:

1. **Immediate** (OPT-115a): Add cookie debugging + profile lock queue
2. **Short-term** (OPT-115b): Extension direct capture for HTML/Screenshot
3. **Medium-term** (OPT-115c): Improve Puppeteer cookie handling for PDF/WARC

This addresses the user's core complaint while maintaining full functionality.

---

## APPROVAL REQUIRED

This plan requires user review. Key decisions:
1. Extension-first approach OK?
2. Queue vs fallback for locked profile?
3. Priority order of fixes?

**Ready for review.**
