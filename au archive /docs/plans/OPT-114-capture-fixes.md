# OPT-114: Web Capture Critical Fixes

**Status**: PLANNING
**Created**: 2025-12-12
**Author**: Claude Code

---

## CRITICAL ROOT CAUSE IDENTIFIED

### The Profile Path Mismatch Bug

**THIS IS THE PRIMARY CAUSE OF BOT DETECTION FAILURES.**

| Service | Profile Path | What It Expects |
|---------|--------------|-----------------|
| **Research Browser** (detached-browser-service.ts:97) | `app.getPath('userData')/research-browser` → `~/Library/Application Support/au-archive/research-browser/` | User's browsing cookies, logins |
| **Capture Service** (websource-capture-service.ts:226) | `~/Library/Application Support/Chromium/` | System Chromium profile (WRONG!) |

**The capture service is looking for cookies in the WRONG directory!**

When the user logs into Zillow via the Research Browser, those cookies are stored in:
```
~/Library/Application Support/au-archive/research-browser/
```

But when the capture service tries to archive, it looks in:
```
~/Library/Application Support/Chromium/
```

These are **completely different directories**. The capture service never sees the user's cookies, so every archive attempt is like a fresh anonymous visit → triggers bot detection.

---

## Issues Identified (Ordered by Impact)

| Issue | Severity | Root Cause | Impact |
|-------|----------|------------|--------|
| **1. Profile path mismatch** | CRITICAL | Different paths in capture vs browser service | No cookie sharing, bot detection triggers |
| **2. Bot detection blocking** | HIGH | Symptom of #1, plus headless mode fingerprinting | Archives show CAPTCHA |
| **3. wget not installed** | MEDIUM | Not bundled with app | Lower quality WARC archives |
| **4. osascript keystroke error** | LOW | macOS Accessibility permissions | Side panel won't auto-open |

---

## Issue 1: Profile Path Mismatch (CRITICAL FIX)

### Current Code (BROKEN)

**websource-capture-service.ts:220-226**:
```typescript
export function getResearchBrowserProfilePath(): string {
  const platform = process.platform;
  let profilePath: string;

  if (platform === 'darwin') {
    // macOS: Ungoogled Chromium stores profile here
    profilePath = path.join(process.env.HOME || '', 'Library', 'Application Support', 'Chromium');
```

**detached-browser-service.ts:96-98**:
```typescript
function getProfilePath(): string {
  return path.join(app.getPath('userData'), 'research-browser');
}
```

### The Fix

Change `getResearchBrowserProfilePath()` to use the SAME path as `detached-browser-service.ts`:

```typescript
export function getResearchBrowserProfilePath(): string {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'research-browser');
}
```

This ensures the capture service uses the EXACT same cookie jar as the Research Browser.

### Why This Wasn't Caught

The original OPT-109/OPT-110 implementation assumed users would use system Chrome/Chromium. When ADR-047 added the custom "Research Browser" (Ungoogled Chromium with custom profile), the capture service path wasn't updated to match.

---

## Issue 2: Bot Detection (Secondary Fixes)

Even with correct cookies, headless mode has fingerprinting issues:

### Problem A: `headless: true` Detection

Modern bot detection services (PerimeterX, Cloudflare) detect:
- Missing `chrome.app` property
- `navigator.webdriver` being true
- Canvas/WebGL fingerprint anomalies
- Timing attack detection

### Solution: Use `headless: 'shell'` (Chrome 129+)

Chrome 129+ introduced new headless mode that matches visible browser exactly:

```typescript
const options: LaunchOptions = {
  executablePath,
  headless: 'shell', // New Chrome 129+ mode, identical to visible browser
  // OR use visible but off-screen:
  // headless: false,
  // args: ['--window-position=-9999,-9999'],
};
```

### Problem B: Stealth Plugin Not Applying

The lazy-load approach may initialize AFTER first browser launch.

### Solution: Ensure stealth applies BEFORE launch

```typescript
async function launchBrowser(): Promise<Browser> {
  // Initialize stealth FIRST
  const puppeteer = await getStealthPuppeteer();

  // Then configure and launch
  const options = { ... };
  return puppeteer.launch(options);
}
```

---

## Issue 3: wget Not Installed (MEDIUM)

### Current Behavior

```
[WARC] wget not found, using enhanced CDP capture
```

CDP capture works but wget produces archival-grade WARC files.

### Solutions

#### Option A: Bundle wget Binary (RECOMMENDED)

Add wget to `resources/bin/` like other binaries.

**Modify `findWgetExecutable()` in websource-capture-service.ts:652**:
```typescript
async function findWgetExecutable(): Promise<string | null> {
  const paths = [
    // Bundled with app (check first)
    path.join(__dirname, '..', '..', '..', '..', 'resources', 'bin', 'wget'),
    path.join(process.resourcesPath || '', 'bin', 'wget'),
    // System paths...
  ];
  // ...
}
```

#### Option B: Download on First Use

Prompt user to install or auto-download:
```
brew install wget
```

---

## Issue 4: osascript Keystroke Error (LOW)

### Current Behavior

```
osascript is not allowed to send keystrokes. (1002)
```

This is a cosmetic error - the Research Browser still works.

### Solution: Remove the Feature

The `openSidePanelViaMacOS()` function in `detached-browser-service.ts:227-242` should be removed. The side panel can be opened manually with Alt+Shift+A.

---

## Implementation Plan

### Phase 1: Fix Profile Path (CRITICAL - Do First)

**File**: `packages/desktop/electron/services/websource-capture-service.ts`

**Change**: Update `getResearchBrowserProfilePath()` to use the same path as `detached-browser-service.ts`:

```typescript
export function getResearchBrowserProfilePath(): string {
  // Use the SAME profile path as the Research Browser
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'research-browser');
}
```

**Remove**: The platform-specific logic that was pointing to wrong directory.

**Test**:
1. Open Research Browser
2. Navigate to Zillow and log in
3. Close Research Browser
4. Archive a Zillow listing
5. Verify: Full content captured, not CAPTCHA

### Phase 2: Improve Headless Mode (HIGH)

**File**: `packages/desktop/electron/services/websource-capture-service.ts`

**Change**: Update `launchBrowser()` to use new headless mode:

```typescript
const options: LaunchOptions = {
  executablePath,
  headless: 'shell', // Chrome 129+ new headless, or use 'new'
  userDataDir,
  args: [
    // Keep existing anti-detection args
  ],
};
```

### Phase 3: Remove Keystroke Feature (LOW)

**File**: `packages/desktop/electron/services/detached-browser-service.ts`

**Remove**:
- Function `openSidePanelViaMacOS()` (lines 227-242)
- Call to `openSidePanelViaMacOS()` in `launchDetachedBrowser()` (if present)

### Phase 4: Bundle wget (OPTIONAL)

**Files**:
- `scripts/setup.sh` - Add wget download
- `websource-capture-service.ts` - Update path search

---

## Files to Modify

| File | Priority | Change |
|------|----------|--------|
| `websource-capture-service.ts` | P0 | Fix profile path, improve headless mode |
| `detached-browser-service.ts` | P2 | Remove osascript feature |
| `scripts/setup.sh` | P3 | Bundle wget (optional) |

---

## Testing Checklist

### After Phase 1 (Profile Fix)
- [ ] Research Browser saves cookies to `~/Library/Application Support/au-archive/research-browser/`
- [ ] Capture service reads from same path
- [ ] Archive Zillow after login → captures content, not CAPTCHA
- [ ] Archive works when Research Browser is closed (profile not locked)
- [ ] Archive falls back correctly when Research Browser is open

### After Phase 2 (Headless Fix)
- [ ] No `navigator.webdriver` detection
- [ ] Stealth plugin initializes before launch
- [ ] Archives work on PerimeterX-protected sites

### After Phase 3 (Keystroke Removal)
- [ ] No error messages about osascript
- [ ] Research Browser launches cleanly
- [ ] Side panel opens with Alt+Shift+A manually

---

## Risk Assessment

| Change | Risk | Mitigation |
|--------|------|------------|
| Profile path change | LOW | Same path as Research Browser |
| Headless mode change | MEDIUM | Test on multiple sites |
| Remove keystroke | NONE | Convenience feature only |

---

## Why This Wasn't Working

### Timeline of Changes

1. **OPT-109** (5094daf): Created websource-capture-service with generic Chromium paths
2. **ADR-047** (68aa629): Added Research Browser with CUSTOM profile path
3. **OPT-112** (60c7e22): Added stealth plugin + "Research Browser cookies" (but path was still wrong!)
4. **OPT-113** (9c1a3f7): Added auto-archive (still using wrong profile path)

The profile path was never updated when ADR-047 introduced the custom Research Browser. The "Research Browser cookies" feature in OPT-112 was a misnomer - it was using system Chromium's profile, not the Research Browser's profile.

---

## READY FOR IMPLEMENTATION

This plan is ready for execution. The Phase 1 fix (profile path) is the critical fix that will restore cookie sharing and dramatically improve archive success rate.

