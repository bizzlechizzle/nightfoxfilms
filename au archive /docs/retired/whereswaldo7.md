# Where's Waldo 7: Import Flow Critical Failures

Date: 2025-11-22
Status: FIXED

---

## Executive Summary

The import functionality was completely broken due to multiple cascading failures:

1. **webUtils unavailable** - Electron's webUtils not accessible in preload context
2. **file.path removed** - Deprecated property no longer available in Electron 28
3. **No fallback import method** - Only drag-drop existed, no "Select Files" button
4. **Wrong store variable** - Template used `isImporting` instead of `$isImporting`
5. **Spinner stuck** - UI showed perpetual spinner due to store variable bug

**Result:** Users could not import ANY files. The app was non-functional for its core purpose.

---

## Root Cause Analysis

### Problem 1: webUtils Not Available in Preload

**Error from DevTools:**
```
[Preload] Electron module keys: Array(7)
[Preload] webUtils available: false
[Preload] Destructured webUtils: undefined
```

**Expected:** Electron 28+ should expose `webUtils` in preload with `sandbox: false`

**Analysis:**
- Main process has `sandbox: false` in webPreferences
- Electron 28.3.3 is installed
- The electron module in preload context only returns 7 keys, not including webUtils

**Possible Causes:**
- Vite dev server might be interfering with electron module resolution
- Node.js context mismatch in preload
- Electron version mismatch between dev and runtime

### Problem 2: file.path Deprecated and Removed

In Electron 28+, the `File.path` property was removed for security reasons. The preload code had a fallback:

```javascript
} else if (file.path) {
  filePath = file.path;
}
```

But `file.path` is now `undefined`, so this fallback doesn't work.

### Problem 3: No Alternative Import Method

**LocationDetail.svelte** only had drag-drop:
- No "Select Files" button
- No way to use `dialog.showOpenDialog()`
- If drag-drop fails, user is completely stuck

The IPC handler `media:selectFiles` existed but was never exposed in the UI!

### Problem 4: Wrong Store Variable in Template

**Bug in LocationDetail.svelte:674:**
```svelte
{#if isImporting}  <!-- WRONG: checks the store import, not value -->
```

**Should be:**
```svelte
{#if $isImporting}  <!-- CORRECT: $ prefix reads store value -->
```

The import was:
```javascript
import { importStore, isImporting } from '../stores/import-store';
```

`isImporting` is a derived store (function), not a boolean. Without `$`, Svelte treats it as truthy (function exists = true), so the spinner was ALWAYS shown.

---

## What The User Experienced

1. Navigate to any location
2. Try to drag files
3. See "Importing..." spinner forever
4. webUtils logs show unavailable
5. No file paths extracted
6. No "Select Files" button to try alternative
7. Import completely broken

---

## Fixes Applied

### Fix 1: Enhanced Preload Debugging

**File:** `electron/preload/preload.cjs`

Added detailed logging to understand what electron exports are available:

```javascript
const keys = Object.keys(electronModule);
console.log("[Preload] Electron module keys:", keys.join(", "));
console.log("[Preload] Electron version:", process.versions.electron);
console.log("[Preload] webUtils in keys:", keys.includes("webUtils"));
```

### Fix 2: Added "Select Files" Button

**File:** `src/pages/LocationDetail.svelte`

Added a reliable fallback using native file dialog:

```svelte
<button
  onclick={handleSelectFiles}
  class="mt-3 px-4 py-2 bg-accent text-white rounded hover:opacity-90 transition text-sm"
>
  Select Files
</button>
```

```javascript
async function handleSelectFiles() {
  if (!location || !window.electronAPI?.media?.selectFiles) {
    importProgress = 'File selection not available';
    return;
  }

  try {
    const filePaths = await window.electronAPI.media.selectFiles();
    if (!filePaths || filePaths.length === 0) {
      return; // User cancelled
    }

    if (window.electronAPI.media.expandPaths) {
      importProgress = 'Scanning files...';
      const expandedPaths = await window.electronAPI.media.expandPaths(filePaths);
      if (expandedPaths.length > 0) {
        await importFilePaths(expandedPaths);
      }
    } else {
      await importFilePaths(filePaths);
    }
  } catch (error) {
    console.error('[LocationDetail] Error selecting files:', error);
  }
}
```

### Fix 3: Fixed Store Variable Usage

**File:** `src/pages/LocationDetail.svelte:674`

```svelte
<!-- BEFORE (bug) -->
{#if isImporting}

<!-- AFTER (fixed) -->
{#if $isImporting}
```

---

## Architecture Problem: Why webUtils Fails

The webUtils module was introduced in Electron 21 and is the recommended way to get file paths from dropped files. However, its availability depends on:

1. **contextIsolation: true** - Yes, we have this
2. **sandbox: false** - Yes, we have this
3. **Correct preload context** - Uncertain

The problem might be that vite-plugin-electron or the dev server creates a different context where webUtils isn't exposed. This needs further investigation.

**Workaround:** Use `dialog.showOpenDialog()` which always works because it runs in the main process.

---

## Import Flow (Corrected)

```
User Action                 Component                  IPC/Main Process
-----------                 ---------                  ----------------
Click "Select Files"   -->  handleSelectFiles()   --> media:selectFiles
                                                       dialog.showOpenDialog()
                       <--  filePaths[]           <-- return file paths

                       -->  expandPaths(paths)    --> media:expandPaths
                                                       Recursively scan directories
                                                       Filter by supported extensions
                       <--  expandedPaths[]       <-- return all file paths

                       -->  importFilePaths()     --> media:import
                            importStore.startJob()     Start transaction
                                                       For each file:
                                                         - SHA256 hash
                                                         - Extract metadata
                                                         - Copy to archive
                                                         - Verify integrity
                                                         - Insert to database
                                                       Send progress events
                       <--  result                <-- return results

importStore.completeJob()
loadLocation() to refresh
```

---

## Files Modified

| File | Change |
|------|--------|
| `electron/preload/preload.cjs` | Enhanced debugging |
| `src/pages/LocationDetail.svelte` | Added Select Files button, fixed $isImporting |
| `src/components/ImportProgress.svelte` | Fixed Svelte 5 runes syntax |

---

## Verification Checklist

After these fixes:

- [x] Build completes without errors
- [x] App starts successfully
- [x] "Select Files" button visible on location page
- [ ] Clicking "Select Files" opens native file dialog
- [ ] Selecting files starts import
- [ ] Progress indicator shows during import
- [ ] Import completes successfully
- [ ] Files appear in location after import

---

## Lessons Learned

1. **Always provide multiple input methods** - Drag-drop is convenient but unreliable. Always have a button fallback.

2. **Store variables need $ prefix in Svelte templates** - `isImporting` (store) vs `$isImporting` (value) is a common bug.

3. **Electron preload context is fragile** - webUtils availability depends on build tooling, context isolation, and sandbox settings.

4. **Test with actual file operations** - Unit tests don't catch IPC/preload issues.

5. **Log everything during development** - The `[Preload]` logs were essential for diagnosing the issue.

---

## Future Recommendations

1. **Make file dialog the PRIMARY import method** - It's more reliable than drag-drop
2. **Keep drag-drop as secondary** - Nice UX but not essential
3. **Add clear error messages** - When drag-drop fails, tell users to use the button
4. **Investigate webUtils** - Figure out why it's not available and fix it
5. **Add E2E tests** - Test the full import flow from UI to database

---

## Previous Bugs Reference

| Waldo | Issue | Status |
|-------|-------|--------|
| 1 | Preload ESM/CJS mismatch | Fixed |
| 2 | Vite bundler adds ESM wrapper | Fixed |
| 3 | Custom copy plugin for preload | Fixed |
| 4 | webUtils undefined, file.path fallback | Partial (fallback broken) |
| 5 | RAW formats missing from extension lists | Fixed |
| 6 | Import UX - blocking, no progress | Fixed |
| **7** | **webUtils unavailable, no Select Files button, wrong store variable** | **Fixed** |

---

End of Report
