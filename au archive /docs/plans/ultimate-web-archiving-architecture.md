# Ultimate Web Archiving Architecture

**Analysis Date:** 2025-12-14
**Status:** PLANNING - Pending User Review

---

## The Core Problem: Two Browsers, Two Sessions

### Current Architecture (Broken Model)

```
User browses with Research Browser (visible, authenticated)
         │
         │ [Cookie file copy - ONE TIME at launch]
         ▼
Archive Browser (headless Puppeteer, separate profile)
         │
         ▼
403 BLOCKED - Site sees different session/fingerprint
```

**Why This Fails:**
1. Cookie copy happens ONCE at browser launch, not per-request
2. Cookies may be locked if Research Browser is open
3. Session tokens expire or rotate - stale cookies don't work
4. localStorage/sessionStorage/IndexedDB NOT copied (only SQLite cookies)
5. Different TLS fingerprint (JA3), different canvas fingerprint, different WebGL hash
6. Sites like Cloudflare/PerimeterX/DataDome fingerprint the BROWSER, not just cookies

### What We Should Do: Single Browser Model

```
User browses with Research Browser (visible, authenticated)
         │
         │ [User clicks "Archive This" in extension]
         ▼
Extension sends message to Electron app
         │
         │ [CDP connection to SAME browser instance]
         ▼
Capture using Chrome DevTools Protocol
         │
         ▼
SUCCESS - Same session, same fingerprint, user sees what we capture
```

**Why This Works:**
- **Same browser** = same fingerprint (no detection possible)
- **Same session** = authenticated access guaranteed
- **User sees the page** = we capture exactly what they see
- **No separate process** = no profile conflicts, no cookie sync

---

## Ass-Chewing Analysis: Custom Solution vs ArchiveBox vs Browsertrix

### Option A: Keep Building Custom (Current Path)

**What We're Building:**
- Puppeteer with stealth plugin
- Separate browser profiles with cookie sync
- Multi-format capture (Screenshot, PDF, HTML, WARC)
- Python text extraction (Trafilatura, BeautifulSoup)
- yt-dlp for videos
- Image hi-res upgrade logic

**Advantages:**
- Deep integration with our location-based workflow
- Control over every aspect
- No Docker, no external services
- Works offline

**Problems:**
- Reinventing the wheel on anti-bot evasion (arms race we'll lose)
- Cookie sync is fundamentally broken
- Two browsers = guaranteed fingerprint mismatch
- Massive maintenance burden

### Option B: Integrate ArchiveBox

**What ArchiveBox Does:**
- Python-based archiver
- Multiple extractors (wget, chrome, singlefile, youtube-dl)
- Self-hosted, Docker-based
- Good for bulk archiving
- Active development (25k+ stars)

**Advantages:**
- Battle-tested extraction methods
- Many output formats
- Large community

**Problems:**
- Docker dependency (violates offline-first architecture)
- Not designed for interactive workflow (give URL → get archive)
- No concept of "use the same browser the user is looking at"
- Still uses headless Chrome = same fingerprint problem
- Doesn't solve the 403 issue at all

**Verdict:** ArchiveBox is for automated bulk archiving, not interactive research.

### Option C: Integrate Browsertrix

**What Browsertrix Does:**
- Webrecorder project (WARC experts)
- Browser-based crawling
- Excellent WARC replay
- Enterprise-grade for institutions

**Advantages:**
- Best-in-class WARC generation
- Faithful replay (ReplayWeb.page)
- Handles complex JS sites

**Problems:**
- Docker/Kubernetes focused (enterprise deployment)
- Overkill for single-user desktop app
- Still launches its own browser = fingerprint problem
- Doesn't integrate with "user's authenticated session"

**Verdict:** Browsertrix is for institutional archiving, not desktop research tool.

### Option D: The Right Architecture (CDP Takeover)

**Fundamental Insight:** Stop launching a second browser. Connect to the one the user is already using.

**Chrome DevTools Protocol (CDP) Approach:**
1. User launches Research Browser with `--remote-debugging-port=9222`
2. When user clicks "Archive This" in extension:
   - Extension captures visible tab info
   - Electron connects to Research Browser via CDP
   - Captures page using same browser instance
3. No second browser, no fingerprint mismatch, no 403s

**This is how professional archiving works:**
- Browser extensions capture what user sees
- No separate headless instance
- Same session, same cookies, same everything

---

## The Ultimate Architecture

### Phase 1: Extension-First Capture (Immediate Fix)

The extension already captures screenshot + HTML + text. **Trust it more.**

```
Extension captures:
├── Screenshot (canvas-based, exact pixel match)
├── HTML (full DOM with inline styles)
├── Text content (already extracted)
├── Cookies (from browser.cookies API)
├── localStorage (from window.localStorage)
└── Metadata (Open Graph, Schema.org, etc.)
```

**Change Required:**
- Extension sends cookies + localStorage with capture
- Electron stores these for authenticated re-fetch if needed
- Skip Puppeteer capture for sites where extension capture succeeded

### Phase 2: CDP Connection for Enhanced Capture

When extension capture isn't enough (PDF, WARC, video):

```typescript
// Connect to Research Browser's debugging port
const browser = await puppeteer.connect({
  browserURL: 'http://localhost:9222',
  defaultViewport: null,
});

// Get the tab user is looking at
const pages = await browser.pages();
const currentPage = pages.find(p => p.url() === targetUrl);

// Capture from EXISTING page - no navigation, no detection
await currentPage.pdf({ path: 'archive.pdf' });
```

**Requirements:**
- Research Browser must launch with `--remote-debugging-port=9222`
- Modify browser launch in `electron/main/research-browser.ts`
- Add CDP connection mode to capture service

### Phase 3: Error Page Detection

Add validation to text extraction:

```python
# In extract-text.py
ERROR_SIGNATURES = [
    ('cloudfront', 'generated by cloudfront'),
    ('cloudfront', 'request could not be satisfied'),
    ('cloudflare', 'checking your browser'),
    ('cloudflare', 'ray id:'),
    ('captcha', 'verify you are human'),
    ('blocked', 'access denied'),
    ('blocked', 'forbidden'),
    ('bot', 'unusual traffic'),
    ('bot', 'automated access'),
]

def detect_error_page(text: str) -> Optional[str]:
    """Returns error type if text appears to be an error page."""
    text_lower = text.lower()
    for error_type, pattern in ERROR_SIGNATURES:
        if pattern in text_lower:
            return error_type
    return None
```

### Phase 4: Session Persistence Layer

Instead of copying cookie files, use browser APIs:

```typescript
// Export cookies from Research Browser via CDP
async function exportSession(page: Page): Promise<SessionData> {
  const cookies = await page.cookies();
  const localStorage = await page.evaluate(() =>
    JSON.stringify(window.localStorage)
  );
  const sessionStorage = await page.evaluate(() =>
    JSON.stringify(window.sessionStorage)
  );

  return { cookies, localStorage, sessionStorage };
}

// Import into Archive Browser for offline re-fetch
async function importSession(page: Page, session: SessionData) {
  await page.setCookie(...session.cookies);
  await page.evaluate((ls) => {
    Object.entries(JSON.parse(ls)).forEach(([k, v]) => {
      localStorage.setItem(k, v);
    });
  }, session.localStorage);
}
```

---

## Anti-Bot Evasion: What Actually Works in 2025

### The Brutal Truth (From Research)

**Over 70% of website traffic is now automated.** Sites have gotten extremely good at detection:

| Detection Layer | What It Checks | Our Current Exposure |
|-----------------|----------------|---------------------|
| TLS Fingerprinting (JA3) | Cipher suites match browser? | EXPOSED - Puppeteer ≠ Chrome |
| CDP Detection | Is browser automated? | EXPOSED - CDP is detectable |
| Canvas/WebGL | Consistent rendering hash? | EXPOSED - Headless differs |
| Behavioral | Mouse, scroll, timing patterns | EXPOSED - No simulation |
| Session | Expected cookies present? | EXPOSED - Stale cookie sync |

**Critical 2024-2025 insight from research:**
> "Being able to detect that a browser is instrumented with CDP is **key to detecting most modern bot frameworks**. CDP detection targets the underlying technology used for automation rather than specific inconsistencies."

This means **even with stealth plugins, Puppeteer/Playwright are fundamentally detectable** because they use CDP.

### Effectiveness Reality Check

| Technique | Effectiveness | Maintenance | Why |
|-----------|--------------|-------------|-----|
| Stealth Plugin | 40-60% | Very High | Arms race, constant updates |
| Anti-detect Browser | 70-85% | High | Commercial, costs $$$ |
| Residential Proxy | +10-20% | High | Helps but not sufficient alone |
| **Same Browser (Extension)** | **100%** | **None** | Not automated = not detectable |

### What ArchiveBox Gets Wrong

ArchiveBox **reveals itself as a bot by default** in User-Agent strings. Their workaround? Manual cookie file setup and URL rewriting to bot-friendly frontends.

This is the wrong approach. We should **never be in an arms race**.

### What Browsertrix Gets Right (But Still Wrong)

Browsertrix uses pre-login browser profiles - smart! But they still launch a **separate browser instance** for each crawl. That browser is detectable via CDP.

### The Only Unbeatable Strategy

**Don't automate. Capture what the user sees directly.**

```
Extension in user's browser (NOT automated) → Captures page → Done
```

No CDP, no Puppeteer, no headless browser. The extension runs IN the user's real browser session. There's nothing to detect because nothing is automated.

### Bot Detection Techniques Sites Use

1. **TLS Fingerprinting (JA3)** - Cipher suites unique per library/browser
2. **CDP Detection** - WebDriver flag, automation artifacts, timing
3. **Canvas Fingerprinting** - Renders text/graphics, hashes output (headless differs)
4. **WebGL Fingerprinting** - GPU-specific rendering (headless lacks GPU)
5. **Navigator Properties** - plugins, languages, platform inconsistencies
6. **Behavioral Analysis** - Mouse movement, scroll patterns, click timing
7. **Cookie/Session Analysis** - Missing expected cookies, session freshness

**Extension capture bypasses ALL of these** because it's running in the user's actual browser, during normal browsing, with their real session.

---

## Implementation Plan

### Step 1: Always Sync Fresh Cookies (Quick Win)
**Files:** `websource-capture-service.ts`
- Call `syncCookiesFromResearchBrowser()` before EVERY capture, not just browser launch
- Also sync localStorage via CDP if Research Browser has debugging port

### Step 2: Error Page Detection in Python
**Files:** `scripts/extract-text.py`
- Add `detect_error_page()` function with CloudFront/Cloudflare signatures
- Return structured error instead of extracted text
- Save error page HTML for ML training

### Step 3: Enhanced Bot Block Detection
**Files:** `websource-orchestrator-service.ts`
- Add CloudFront-specific patterns
- Detect by Request ID format (unique to CloudFront)
- Save blocked page artifacts for debugging

### Step 4: Research Browser CDP Mode
**Files:** `electron/main/research-browser.ts`, `websource-capture-service.ts`
- Launch Research Browser with `--remote-debugging-port=9222`
- Add `captureViaCDP()` function that connects to running browser
- Use for PDF/WARC when extension capture exists

### Step 5: Extension-First Architecture
**Files:** `websource-orchestrator-service.ts`
- If extension captured HTML/screenshot/text, trust those
- Only use Puppeteer for PDF/WARC/video
- Skip re-fetch entirely for sites where extension succeeded

### Step 6: ML Error Detection (Future)
**Files:** New `scripts/train-error-detector.py`
- Collect 403/block pages (currently being saved)
- Train classifier to detect error pages
- Use as fallback when pattern matching fails

---

## Questions Answered

### Q1: Cookie sync frequency
**Answer:** Before EVERY capture, not just browser launch. Implement via CDP for real-time session access.

### Q2: User prompt on 403
**Answer:** Show toast notification: "This site blocked automated access. Content may be incomplete. Try opening in Research Browser first." Auto-retry silently after user visits.

### Q3: Keep error page artifacts
**Answer:** Yes, save to `_websources/[sourceId]/errors/`:
- `error.html` - Full HTML of error page
- `error.png` - Screenshot of error
- `error.json` - Detection metadata (patterns matched, timestamps)

### Q4: What would make this the ULTIMATE tool?

**The Ultimate Web Archiving Tool Would Have:**

| Feature | Status | Notes |
|---------|--------|-------|
| Zero-Friction Capture | 70% | Extension exists, needs to be primary |
| Authentication Passthrough | 30% | Cookie sync broken, extension can fix |
| No Bot Detection | 0% | Puppeteer is detectable, extension is not |
| Multi-Format Output | 90% | Screenshot, PDF, HTML, WARC all work |
| Video/Audio Extraction | 100% | yt-dlp integration done |
| Image Hi-Res Upgrade | 100% | srcset parsing done |
| Text Intelligence | 100% | Entity extraction, date detection done |
| Offline Replay | 0% | ReplayWeb.page not integrated |
| Change Detection | 0% | Future feature |
| Scheduled Monitoring | 0% | Future feature |
| Error Detection | 0% | 403 pages stored as content |
| ML Training Pipeline | 0% | Need to collect error samples |

**Current Score: 50%. The 403 problem + extension-first flip = remaining 50%.**

### The Killer Feature Nobody Has

**Seamless Research-to-Archive Flow:**

```
User finds interesting page while researching
        │
        ▼
User clicks extension → Page archived with full auth
        │
        ▼
User continues researching (zero friction)
        │
        ▼
All archived pages auto-linked to location
        │
        ▼
Offline access, full-text search, timeline view
```

ArchiveBox and Browsertrix are **batch archivers**. They take URLs and process them.

We're building a **research tool**. The archive happens AS the user researches, using THEIR browser session, with ZERO friction.

This is fundamentally different and nobody else does it.

---

## Files to Modify

| File | Change | Priority |
|------|--------|----------|
| `websource-capture-service.ts` | Sync cookies before every capture, add CDP mode | HIGH |
| `websource-orchestrator-service.ts` | Add CloudFront patterns, trust extension capture | HIGH |
| `scripts/extract-text.py` | Add error page detection | HIGH |
| `electron/main/research-browser.ts` | Add `--remote-debugging-port` flag | MEDIUM |
| `websource-extraction-service.ts` | Check Python error response | MEDIUM |
| New: `scripts/error-patterns.json` | Centralized error signatures for ML | LOW |

---

## Revised Implementation Plan

### Phase 1: Error Detection (Fix the Symptom)
**Goal:** Stop treating 403 pages as content

| Task | File | Change |
|------|------|--------|
| 1.1 | `scripts/extract-text.py` | Add `detect_error_page()` with CloudFront/Cloudflare signatures |
| 1.2 | `websource-extraction-service.ts` | Check Python response for `is_error_page` flag |
| 1.3 | `websource-orchestrator-service.ts` | Add CloudFront Request ID pattern to `detectBotBlock()` |
| 1.4 | New error storage | Save error pages to `_websources/[sourceId]/errors/` for ML training |

**Deliverable:** 403 pages flagged as errors, not stored as content.

### Phase 2: Extension-First Architecture (Fix the Cause)
**Goal:** Trust extension capture, skip Puppeteer when possible

| Task | File | Change |
|------|------|--------|
| 2.1 | `bookmark-api-server.ts` | Extension already sends HTML/screenshot/text - expand with cookies/localStorage |
| 2.2 | `websource-orchestrator-service.ts` | If extension captured HTML/screenshot/text → skip Puppeteer re-fetch |
| 2.3 | `websource-capture-service.ts` | Only launch Puppeteer for PDF/WARC/video (formats extension can't do) |
| 2.4 | Extension v2 | Add `browser.cookies.getAll()` and `localStorage` to capture payload |

**Deliverable:** Most captures complete instantly via extension. Puppeteer only for PDF/WARC.

### Phase 3: Real-Time Cookie Sync (Fallback)
**Goal:** When Puppeteer IS needed, use fresh session data

| Task | File | Change |
|------|------|--------|
| 3.1 | `websource-capture-service.ts` | Call `syncCookiesFromResearchBrowser()` before EVERY capture |
| 3.2 | `websource-capture-service.ts` | Add localStorage sync via CDP connection to Research Browser |
| 3.3 | `electron/main/research-browser.ts` | Launch with `--remote-debugging-port=9222` |
| 3.4 | New `session-sync-service.ts` | Centralize session export/import logic |

**Deliverable:** Puppeteer uses same session as Research Browser.

### Phase 4: CDP Takeover (Ultimate Solution)
**Goal:** Eliminate Archive Browser entirely

| Task | File | Change |
|------|------|--------|
| 4.1 | `websource-capture-service.ts` | Add `captureViaResearchBrowser()` using `puppeteer.connect()` |
| 4.2 | Remove Archive Browser | Delete `archive-browser-profile` concept |
| 4.3 | PDF/WARC from same tab | Capture from user's current tab, no navigation |

**Deliverable:** Zero fingerprint mismatch. Same browser for everything.

### Phase 5: ML Error Detection (Future)
**Goal:** Catch novel error pages automatically

| Task | File | Change |
|------|------|--------|
| 5.1 | Collect samples | 403/block pages saved in Phase 1 |
| 5.2 | Train classifier | Simple text classifier (bag of words or small transformer) |
| 5.3 | Deploy | Fallback when pattern matching fails |

**Deliverable:** Self-improving error detection.

---

## Immediate Action Items (Your Approval Needed)

1. **Phase 1 first?** Fix 403 detection immediately. Low risk, high value.

2. **Phase 2 commit?** Make extension the primary capture source. This is an architecture change.

3. **CDP port security?** `--remote-debugging-port=9222` binds to localhost only. Is this acceptable for the local-only app?

4. **Extension update scope?** Adding cookies/localStorage to capture payload requires extension version bump.

---

## Summary: Why This Plan Works

| Current Problem | Solution | Why It Works |
|-----------------|----------|--------------|
| 403 treated as content | Pattern detection in Python | Catches error pages before storage |
| Puppeteer gets blocked | Extension-first capture | Extension runs in real browser, undetectable |
| Cookie sync stale | Real-time sync via CDP | Fresh session on every capture |
| Two browser fingerprints | CDP takeover | One browser, one fingerprint |
| Novel error pages | ML classifier | Learns from collected samples |

**Bottom line:** Stop fighting the arms race. Use the user's browser directly.

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| CDP port security | Localhost only, no remote access |
| Extension becomes critical path | Puppeteer fallback for extension failures |
| Breaking change to extension | Version bump, backwards compat for old payload format |
| Research Browser not running | Queue captures until browser available |

---

## Hybrid Approach: Our Capture + Webrecorder Tools

### What We Borrow From Webrecorder

| Tool | What It Does | Integration |
|------|--------------|-------------|
| [js-wacz](https://github.com/harvard-lil/js-wacz) | Convert WARC → WACZ | npm dependency |
| [ReplayWeb.page](https://replayweb.page/) | View archived pages | Embed web component |
| WACZ format | Portable archive standard | Output format |

### Why Hybrid Works

```
Our Extension (undetectable) → Our Capture → Our WARC → js-wacz → WACZ → ReplayWeb.page
```

- **No Docker** - js-wacz is a Node.js package
- **No re-login** - Extension uses user's session
- **Best output format** - WACZ is industry standard
- **Best viewer** - ReplayWeb.page for faithful playback

### Dependencies to Add

```json
{
  "dependencies": {
    "@harvard-lil/js-wacz": "^0.3.0"
  }
}
```

### WACZ Conversion Code

```typescript
import { WACZ } from '@harvard-lil/js-wacz';

async function convertToWACZ(warcPath: string, outputPath: string): Promise<void> {
  const archive = new WACZ({
    input: warcPath,
    output: outputPath,
  });
  await archive.process();
}
```

---

## User Notification: Keep Browser Open

### Problem
CDP connection to Research Browser requires the browser to be running. If user closes it mid-capture, PDF/WARC generation fails.

### Solution: Multi-Level Notification

#### Level 1: Pre-Capture Warning
When user initiates capture that needs PDF/WARC:

```
┌─────────────────────────────────────────────────────────┐
│ ⚠️  Keep Research Browser Open                          │
│                                                         │
│ Generating PDF and WARC archive...                     │
│ Please keep the Research Browser open until complete.  │
│                                                         │
│ [━━━━━━━━━░░░░░░░░░░░] 45%                             │
│                                                         │
│ ✓ Screenshot captured                                   │
│ ✓ HTML saved                                           │
│ ⋯ Generating PDF...                                    │
│ ○ Creating WARC archive                                │
└─────────────────────────────────────────────────────────┘
```

#### Level 2: Browser Closed Detection
If browser closes during capture:

```
┌─────────────────────────────────────────────────────────┐
│ ❌ Research Browser Closed                              │
│                                                         │
│ PDF and WARC generation was interrupted.               │
│                                                         │
│ Captured:                                               │
│ ✓ Screenshot                                           │
│ ✓ HTML                                                 │
│ ✓ Text extraction                                      │
│                                                         │
│ Missing:                                                │
│ ✗ PDF                                                  │
│ ✗ WARC archive                                         │
│                                                         │
│ [Retry with Browser]  [Accept Partial]                 │
└─────────────────────────────────────────────────────────┘
```

#### Level 3: Extension Badge
Show capture count in extension badge while capture in progress:

```
[Extension Icon with "2" badge] ← 2 captures pending
```

### Implementation

| File | Change |
|------|--------|
| `websource-orchestrator-service.ts` | Detect browser disconnect, handle gracefully |
| `src/components/CaptureProgress.svelte` | New progress modal component |
| `src/stores/capture-status.ts` | Track active captures |
| Browser extension | Badge API for pending count |

---

## Testing Plan: 403 Scenario

### Test Case: The Exact Failure That Started This

**URL that failed:** (CloudFront-protected page user was viewing)

#### Test 1: Verify Current Failure (Before Fix)
```bash
# 1. User browses to protected page in Research Browser
# 2. User is logged in, can see content
# 3. User clicks "Archive This" extension
# 4. Expected: 403 error stored as extracted text ❌
```

#### Test 2: Error Detection (Phase 1 Fix)
```bash
# After implementing error detection in extract-text.py
# 1. Same scenario
# 2. Expected: 403 detected, flagged as error ✓
# 3. Error page saved to errors/ folder ✓
# 4. User notified "Access blocked - content incomplete" ✓
```

#### Test 3: Extension-First Capture (Phase 2 Fix)
```bash
# After implementing extension-first architecture
# 1. Same scenario
# 2. Expected: Extension captures HTML/screenshot/text ✓
# 3. Puppeteer NOT called for protected page ✓
# 4. Full content archived from user's session ✓
```

#### Test 4: CDP Takeover (Phase 4 Fix)
```bash
# After implementing CDP connection
# 1. Same scenario
# 2. Expected: PDF generated from user's tab ✓
# 3. WARC generated from user's session ✓
# 4. 100% content fidelity ✓
```

### Test Matrix

| Scenario | Current | Phase 1 | Phase 2 | Phase 4 |
|----------|---------|---------|---------|---------|
| Public page | ✓ | ✓ | ✓ | ✓ |
| Login-required page | ❌ 403 | ❌ Detected | ✓ Extension | ✓ Full |
| CloudFront protected | ❌ Stored | ✓ Flagged | ✓ Extension | ✓ Full |
| Cloudflare challenge | ❌ Stored | ✓ Flagged | ✓ Extension | ✓ Full |
| PDF generation | ✓ | ✓ | ⚠️ Skip | ✓ CDP |
| WARC generation | ✓ | ✓ | ⚠️ Skip | ✓ CDP |

### Regression Tests

After each phase, verify:
- [ ] Public pages still capture correctly
- [ ] YouTube videos still extract via yt-dlp
- [ ] Image hi-res upgrade still works
- [ ] Text extraction quality unchanged
- [ ] Timeline integration still works

---

## Audit Checklist: AI Integration Spec Compliance

### From AI Integration Audit Document

#### A.1 Universal LM Instructions
| Requirement | Status | Notes |
|-------------|--------|-------|
| Accuracy first | N/A | This plan is browser fixes, not LLM |
| Source attribution | ✓ | Error pages tracked with source URL |
| Context awareness | ✓ | Urbex/abandoned location context preserved |

#### A.2 Timeline System
| Requirement | Status | Notes |
|-------------|--------|-------|
| Date extraction | Unchanged | Browser fix doesn't affect |
| Source linking | ✓ Enhanced | Error pages now linked as failed sources |
| Confidence scoring | ✓ Enhanced | Captures now have success/partial/failed status |

#### B.3 Current Extraction Pipeline
| Requirement | Status | Notes |
|-------------|--------|-------|
| spaCy integration | Unchanged | Browser fix doesn't affect |
| Entity extraction | Unchanged | Browser fix doesn't affect |
| Verification step | ✓ Added | Error page detection is new verification |

#### B.4 Settings System
| Requirement | Status | Notes |
|-------------|--------|-------|
| Browser settings | ✓ New | CDP port configuration |
| Capture settings | ✓ New | Extension-first toggle |

#### B.6 Import Pipeline
| Requirement | Status | Impact |
|-------------|--------|--------|
| Web source import | ✓ Fixed | No more 403 as content |
| Error handling | ✓ Enhanced | Graceful degradation |
| Progress reporting | ✓ Enhanced | Keep-browser-open notification |

#### B.8 Security
| Requirement | Status | Notes |
|-------------|--------|-------|
| CDP port security | ✓ | Localhost only (127.0.0.1:9222) |
| Session data | ⚠️ Caution | Cookies/localStorage now captured |
| No remote access | ✓ | All local, no network exposure |

### Compliance Summary

| Area | Compliant? | Action Needed |
|------|------------|---------------|
| Offline-first | ✓ Yes | All changes work offline |
| Data ownership | ✓ Yes | All data stays local |
| No AI mention in UI | ✓ Yes | Error messages are technical, not AI |
| Source attribution | ✓ Yes | Error pages tracked with metadata |
| Real-time UI updates | ✓ Yes | Progress notifications added |

---

## Final Implementation Checklist

### Pre-Implementation
- [ ] User approves CDP debugging port (security review)
- [ ] User approves extension-first architecture change
- [ ] User confirms WACZ output format is desired

### Phase 1: Error Detection
- [ ] Add ERROR_SIGNATURES to `extract-text.py`
- [ ] Add `detect_error_page()` function
- [ ] Update `ExtractionResult` dataclass
- [ ] Add CloudFront patterns to `websource-orchestrator-service.ts`
- [ ] Create error storage directory structure
- [ ] Test with known 403 URL

### Phase 2: Extension-First
- [ ] Update extension to send cookies/localStorage
- [ ] Update `bookmark-api-server.ts` to receive session data
- [ ] Update orchestrator to skip Puppeteer when extension succeeded
- [ ] Test with protected page

### Phase 3: Real-Time Cookie Sync
- [ ] Modify Research Browser launch with `--remote-debugging-port`
- [ ] Create `session-sync-service.ts`
- [ ] Add sync before every Puppeteer capture
- [ ] Test with expiring session tokens

### Phase 4: CDP Takeover
- [ ] Add `puppeteer.connect()` path
- [ ] Add `captureViaResearchBrowser()` function
- [ ] Remove Archive Browser profile
- [ ] Test PDF/WARC from user's tab

### Phase 5: WACZ Integration
- [ ] Add js-wacz dependency
- [ ] Add WARC → WACZ conversion
- [ ] Evaluate ReplayWeb.page integration
- [ ] Test archive playback

### Post-Implementation
- [ ] Run full test matrix
- [ ] Run regression tests
- [ ] Update lilbits.md if scripts added
- [ ] Document in techguide.md

---

## References

- [ArchiveBox Security Overview](https://github.com/ArchiveBox/ArchiveBox/wiki/Security-Overview)
- [Browsertrix Architecture](https://webrecorder.net/browsertrix/)
- [CDP Detection in Bot Frameworks](https://substack.thewebscraping.club/p/playwright-stealth-cdp)
- [Browser Fingerprinting Defense 2025](https://mr-alias.com/articles/browser-fingerprinting-defense.html)
- [Bypass Bot Detection 2025](https://www.scraperapi.com/web-scraping/how-to-bypass-bot-detection/)
- [js-wacz (Harvard LIL)](https://github.com/harvard-lil/js-wacz)
- [WACZ Format Specification](https://specs.webrecorder.net/wacz/1.1.1/)
- [ReplayWeb.page](https://replayweb.page/)
