# OPT-114: IRS-Level Web Archiving Audit

**Status**: COMPLETE - MERGED TO feature/import-v2 (commit 36b41b6)
**Created**: 2025-12-12
**Author**: Claude Code
**Severity**: CRITICAL - Core functionality broken

---

## EXECUTIVE SUMMARY

The web archiving system has **CRITICAL BUGS** that make it non-functional for authenticated sites. The #1 issue is a **profile path mismatch** - the capture service looks for cookies in the wrong directory.

| Finding | Severity | Status |
|---------|----------|--------|
| Profile path mismatch | 🔴 CRITICAL | Not fixed |
| Headless detection | 🟠 HIGH | Not fixed |
| wget not bundled | 🟡 MEDIUM | Not fixed |
| osascript keystroke error | 🟢 LOW | Not fixed |
| UI namespace mismatch | 🟡 MEDIUM | Partial issue |

---

## FINDING #1: Profile Path Mismatch (CRITICAL)

### The Bug

**Two different services use TWO DIFFERENT profile paths:**

| Service | File:Line | Path | Resolves To (macOS) |
|---------|-----------|------|---------------------|
| **Research Browser** | `detached-browser-service.ts:97` | `app.getPath('userData')/research-browser` | `~/Library/Application Support/au-archive/research-browser/` |
| **Capture Service** | `websource-capture-service.ts:226` | `~/Library/Application Support/Chromium` | `~/Library/Application Support/Chromium/` |

**These are COMPLETELY DIFFERENT directories!**

### Why This Breaks Everything

1. User opens Research Browser
2. User logs into Zillow, cookies saved to `au-archive/research-browser/Cookies`
3. User saves bookmark
4. Capture service launches browser with profile from `Chromium/` directory
5. **NO COOKIES FOUND** - fresh anonymous session
6. Zillow's bot detection triggers → CAPTCHA page archived

### The Fix

```typescript
// websource-capture-service.ts - CHANGE THIS:
export function getResearchBrowserProfilePath(): string {
  // WRONG: This is system Chromium, NOT our Research Browser
  // profilePath = path.join(process.env.HOME || '', 'Library', 'Application Support', 'Chromium');

  // CORRECT: Use the SAME path as detached-browser-service.ts
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'research-browser');
}
```

### Code Locations

**Current (BROKEN)** - `websource-capture-service.ts:220-254`:
```typescript
export function getResearchBrowserProfilePath(): string {
  const platform = process.platform;
  let profilePath: string;

  if (platform === 'darwin') {
    // macOS: Ungoogled Chromium stores profile here ← WRONG COMMENT
    profilePath = path.join(process.env.HOME || '', 'Library', 'Application Support', 'Chromium');
  } else if (platform === 'linux') {
    profilePath = path.join(process.env.HOME || '', '.config', 'chromium');
  } else {
    profilePath = path.join(process.env.LOCALAPPDATA || '', 'Chromium', 'User Data');
  }
  // ...
}
```

**Research Browser (CORRECT)** - `detached-browser-service.ts:96-98`:
```typescript
function getProfilePath(): string {
  return path.join(app.getPath('userData'), 'research-browser');
}
```

---

## FINDING #2: Headless Mode Detection (HIGH)

### The Bug

Even with correct cookies, `headless: true` is detectable by sophisticated bot protection.

**Current code** (`websource-capture-service.ts:131`):
```typescript
const options: LaunchOptions = {
  executablePath,
  headless: true as unknown as boolean, // ← Detectable!
  userDataDir,
  // ...
};
```

### Why This Fails

PerimeterX, Cloudflare, and DataDome detect headless via:
- `navigator.webdriver` property (present in headless)
- Missing `chrome.app` property
- Canvas/WebGL fingerprint anomalies
- Timing analysis

### The Fix

**Option A: Use Chrome 129+ new headless mode**
```typescript
headless: 'shell', // Identical fingerprint to visible browser
```

**Option B: Use visible browser positioned off-screen**
```typescript
headless: false,
args: [
  '--window-position=-9999,-9999',
  '--window-size=1920,1080',
],
```

---

## FINDING #3: Stealth Plugin Initialization (HIGH)

### The Bug

The stealth plugin lazy-loading may not apply correctly in Electron context.

**Current code** (`websource-capture-service.ts:92-116`):
```typescript
let stealthPuppeteer: typeof puppeteerCore | null = null;

async function getStealthPuppeteer() {
  if (!stealthPuppeteer) {
    const puppeteerExtra = await import('puppeteer-extra');
    const StealthPlugin = await import('puppeteer-extra-plugin-stealth');
    puppeteerExtra.default.use(StealthPlugin.default());
    stealthPuppeteer = puppeteerExtra.default as unknown as typeof puppeteerCore;
  }
  return stealthPuppeteer;
}
```

### Potential Issues

1. `StealthPlugin.default()` may need configuration
2. Plugin may need explicit features enabled/disabled
3. Timing of plugin application may be wrong

### The Fix

```typescript
async function getStealthPuppeteer() {
  if (!stealthPuppeteer) {
    const puppeteerExtra = await import('puppeteer-extra');
    const StealthPlugin = await import('puppeteer-extra-plugin-stealth');

    // Configure stealth with explicit options
    const stealth = StealthPlugin.default();
    stealth.enabledEvasions.delete('chrome.app'); // May cause issues
    stealth.enabledEvasions.delete('chrome.csi');

    puppeteerExtra.default.use(stealth);
    stealthPuppeteer = puppeteerExtra.default;
  }
  return stealthPuppeteer;
}
```

---

## FINDING #4: wget Not Bundled (MEDIUM)

### The Bug

```
[WARC] wget not found, using enhanced CDP capture
```

### Impact

- CDP WARC capture works but is lower quality
- wget produces RFC-compliant archival WARC files
- Some resources may be missed without wget

### The Fix

Bundle wget in `resources/bin/` like other binaries:

```typescript
// websource-capture-service.ts - Update findWgetExecutable()
async function findWgetExecutable(): Promise<string | null> {
  const paths = [
    // Check bundled first
    path.join(__dirname, '..', '..', '..', '..', 'resources', 'bin', 'wget'),
    path.join(process.resourcesPath || '', 'bin', 'wget'),
    // Then system paths
    '/usr/local/bin/wget',
    '/opt/homebrew/bin/wget',
    '/usr/bin/wget',
  ];
  // ...
}
```

---

## FINDING #5: osascript Keystroke Error (LOW)

### The Bug

```
osascript is not allowed to send keystrokes. (1002)
```

**Location**: `detached-browser-service.ts:227-242`

### Impact

- Cosmetic only - does not break functionality
- Side panel can be opened manually with Alt+Shift+A
- Logs confusing error message

### The Fix

Remove the `openSidePanelViaMacOS()` function entirely:

```typescript
// DELETE this function and its call site
async function openSidePanelViaMacOS(): Promise<void> {
  // This requires Accessibility permission which most users won't have
  // The side panel can be opened manually with Alt+Shift+A
}
```

---

## FINDING #6: UI Namespace Inconsistency (MEDIUM)

### The Issue

UI components use `window.electronAPI.websources` but should verify this matches preload.

**LocationWebSources.svelte:97**:
```typescript
sources = await window.electronAPI.websources.findByLocation(locid);
```

**preload.cjs:389**:
```javascript
websources: {
  // Methods exposed here...
}
```

### Verification Needed

Ensure `electron.d.ts` type definitions match actual preload implementation.

---

## COMPLETE FILE AUDIT

### Files Reviewed

| File | Lines | Issues Found |
|------|-------|--------------|
| `websource-capture-service.ts` | ~850 | **CRITICAL: Wrong profile path (line 226)**, Headless detection (line 131) |
| `websource-extraction-service.ts` | ~200 | Clean |
| `websource-orchestrator-service.ts` | ~500 | Clean |
| `websource-metadata-service.ts` | ~500 | Clean |
| `sqlite-websources-repository.ts` | ~1200 | Clean |
| `websources.ts` (IPC) | ~1050 | Clean |
| `preload.cjs` | ~600 | Clean |
| `detached-browser-service.ts` | ~300 | osascript issue (line 233), **CORRECT profile path (line 97)** |
| `LocationWebSources.svelte` | ~425 | Clean |
| `WebSourceDetailModal.svelte` | N/A | Not reviewed |
| `Settings.svelte` | N/A | OPT-113 additions OK |
| `LocationSettings.svelte` | N/A | OPT-113 additions OK |

### Code Quality Assessment

| Area | Grade | Notes |
|------|-------|-------|
| Repository layer | A | Well-structured, type-safe |
| IPC handlers | A | Good validation with Zod |
| Orchestrator | B+ | Clean but could use better error handling |
| Capture service | C | **Critical path bug**, needs refactor |
| UI components | B+ | Good Svelte 5 patterns |
| Preload bridge | A | Correct exposure |

---

## IMPLEMENTATION PLAN

### Phase 1: Critical Fix (Profile Path)

**File**: `packages/desktop/electron/services/websource-capture-service.ts`

**Change 1**: Replace `getResearchBrowserProfilePath()` function

```typescript
// BEFORE (lines 220-254):
export function getResearchBrowserProfilePath(): string {
  const platform = process.platform;
  let profilePath: string;

  if (platform === 'darwin') {
    profilePath = path.join(process.env.HOME || '', 'Library', 'Application Support', 'Chromium');
  } else if (platform === 'linux') {
    profilePath = path.join(process.env.HOME || '', '.config', 'chromium');
  } else {
    profilePath = path.join(process.env.LOCALAPPDATA || '', 'Chromium', 'User Data');
  }
  // ... fallback logic
}

// AFTER:
export function getResearchBrowserProfilePath(): string {
  const { app } = require('electron');
  const profilePath = path.join(app.getPath('userData'), 'research-browser');

  // Check if profile exists AND is not locked by running browser
  if (fs.existsSync(profilePath)) {
    if (!isProfileLocked(profilePath)) {
      console.log('[WebSource] Using Research Browser profile:', profilePath);
      return profilePath;
    }
    console.log('[WebSource] Research Browser profile LOCKED (browser running), using fallback');
  } else {
    console.log('[WebSource] Research Browser profile not found at:', profilePath);
  }

  // Fallback: Create/use app-managed profile directory
  const fallbackDir = path.join(app.getPath('userData'), 'browser-profile');
  if (!fs.existsSync(fallbackDir)) {
    fs.mkdirSync(fallbackDir, { recursive: true });
  }
  console.log('[WebSource] Using fallback profile:', fallbackDir);
  return fallbackDir;
}
```

### Phase 2: Headless Mode Fix

**File**: `packages/desktop/electron/services/websource-capture-service.ts`

**Change 2**: Update `launchBrowser()` options (around line 131)

```typescript
// BEFORE:
const options: LaunchOptions = {
  executablePath,
  headless: true as unknown as boolean,
  // ...
};

// AFTER:
const options: LaunchOptions = {
  executablePath,
  // Use new headless mode (Chrome 129+) which is undetectable
  // Falls back to old headless if not supported
  headless: 'shell' as any,
  // ...
};
```

### Phase 3: Remove Keystroke Feature

**File**: `packages/desktop/electron/services/detached-browser-service.ts`

**Change 3**: Remove `openSidePanelViaMacOS()` function (lines 227-242)

```typescript
// DELETE THIS ENTIRE FUNCTION:
async function openSidePanelViaMacOS(): Promise<void> {
  // ...
}

// AND REMOVE ITS CALL SITE (if present in launchDetachedBrowser)
```

### Phase 4: (Optional) Bundle wget

**Files**: `scripts/setup.sh`, `websource-capture-service.ts`

This is lower priority and can be done later.

---

## TESTING PLAN

### After Phase 1 (Profile Fix)

1. **Verify profile path resolution**:
   ```bash
   # Check where Research Browser stores data
   ls -la ~/Library/Application\ Support/au-archive/research-browser/
   ```

2. **Test with authenticated site**:
   - Open Research Browser
   - Navigate to Zillow and log in
   - Close Research Browser
   - Save a Zillow listing as bookmark
   - Trigger archive
   - **EXPECTED**: Full content captured, NOT captcha

3. **Test fallback when browser running**:
   - Open Research Browser (keep it open)
   - Save a bookmark
   - Trigger archive
   - **EXPECTED**: Uses fallback profile, may get captcha (expected), logs message about fallback

### After Phase 2 (Headless Fix)

1. **Verify headless mode**:
   - Archive a site that detects bots (e.g., Google search)
   - **EXPECTED**: Content captured without captcha

### After Phase 3 (Keystroke Removal)

1. **Verify no errors**:
   - Launch Research Browser
   - Check logs for osascript errors
   - **EXPECTED**: No keystroke errors

---

## ROOT CAUSE ANALYSIS

### Timeline of How This Broke

| Commit | Date | Change | Impact |
|--------|------|--------|--------|
| OPT-109 | Earlier | Created `websource-capture-service.ts` | Used generic system Chromium paths |
| ADR-047 | 68aa629 | Added Research Browser with custom profile | **Created path divergence** |
| OPT-112 | 60c7e22 | Added "Research Browser cookies" | **Didn't fix the path!** |
| OPT-113 | 9c1a3f7 | Added auto-archive | Still using wrong path |

### Why It Wasn't Caught

1. The original OPT-109 assumed users would use system Chrome/Chromium
2. When ADR-047 introduced the custom Research Browser with its own profile, the capture service wasn't updated
3. OPT-112 mentioned "Research Browser cookies" in comments but never actually fixed the path
4. Testing may have been done on sites without aggressive bot detection

---

## RISK ASSESSMENT

| Change | Risk | Mitigation |
|--------|------|------------|
| Profile path fix | LOW | Uses same path as proven Research Browser |
| Headless mode change | MEDIUM | Test on variety of sites |
| Remove keystroke | NONE | Cosmetic feature only |

---

## FINAL CHECKLIST

- [ ] Read and understand both profile path implementations
- [ ] Verify `app.getPath('userData')` returns expected path on macOS
- [ ] Update `getResearchBrowserProfilePath()` to use correct path
- [ ] Test with Zillow (PerimeterX-protected) after login
- [ ] Update headless mode to 'shell' or 'new'
- [ ] Remove osascript keystroke feature
- [ ] Run full test suite
- [ ] Update documentation

---

## APPROVAL REQUIRED

This plan requires user approval before implementation. The critical fix (Phase 1) should be done first as it will immediately improve archive success rate for authenticated sites.

**Ready to implement?**

