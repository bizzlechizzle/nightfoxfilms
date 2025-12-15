# Plan: Lightbox Hero Image Section Cleanup

## Summary

Clean up the hero image UI in the lightbox info panel and add Dashboard hero feature:
1. Remove star icons from buttons
2. Standardize button text to "Hero Image"
3. Remove instructional text from focal editor popup
4. Add "Dashboard" and "Host-Location" buttons to focal editor popup
5. Implement Dashboard hero storage and display

## Current State

**File**: `packages/desktop/src/components/MediaViewer.svelte`

### Current Hero Section (lines 611-681)
- Section header: "Hero Image" (correct)
- "Current Hero" badge has star icon (line 633-635)
- Button text varies:
  - When `isCurrentHero`: "Adjust" or "Adjust Position" with image icon
  - When not hero: "Set as Hero Image" with star icon
  - Side-by-side: "Building Hero" / "Campus Hero"

### Current Focal Editor Popup (lines 969-1069)
- Header: "Set Hero Focal Point"
- Subheader: "Drag the pin to set the center of the hero crop" (line 982)
- Save button text varies by context
- No Dashboard/Host-Location buttons

## Proposed Changes

### Change 1: Remove star from "Current Hero" badge

**File**: `MediaViewer.svelte` **Lines**: 632-637

**From**:
```svelte
<span class="inline-flex items-center gap-1 px-2 py-1 bg-accent text-white text-xs font-medium rounded shadow-sm">
  <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
    <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674..." />
  </svg>
  Current Hero
</span>
```

**To**:
```svelte
<span class="inline-flex items-center px-2 py-1 bg-accent text-white text-xs font-medium rounded shadow-sm">
  Current Hero
</span>
```

---

### Change 2: Simplify single button to "Hero Image"

**File**: `MediaViewer.svelte` **Lines**: 665-680

**From**:
```svelte
<button onclick={() => startFocalEdit('building')} class="...">
  {#if isCurrentHero}
    <svg>...</svg>
    Adjust Position
  {:else}
    <svg>...</svg>
    Set as Hero Image
  {/if}
</button>
```

**To**:
```svelte
<button onclick={() => startFocalEdit('building')} class="...">
  Hero Image
</button>
```

---

### Change 3: Simplify side-by-side buttons

**File**: `MediaViewer.svelte` **Lines**: 644-661

**From**:
```svelte
<button onclick={() => startFocalEdit('building')} class="...">
  <svg>...</svg>
  {isCurrentHero ? 'Adjust' : 'Building Hero'}
</button>
<button onclick={() => startFocalEdit('campus')} class="...">
  <svg>...</svg>
  Campus Hero
</button>
```

**To**:
```svelte
<button onclick={() => startFocalEdit('building')} class="...">
  Hero Image
</button>
<button onclick={() => startFocalEdit('campus')} class="...">
  Host-Location
</button>
```

(Remove SVG icons from both buttons)

---

### Change 4: Remove instructional text from focal editor popup

**File**: `MediaViewer.svelte` **Line**: 982

**From**:
```svelte
<h3 class="text-lg font-semibold text-gray-900">Set Hero Focal Point</h3>
<p class="text-sm text-gray-500 mt-1">Drag the pin to set the center of the hero crop</p>
```

**To**:
```svelte
<h3 class="text-lg font-semibold text-gray-900">Set Hero Focal Point</h3>
```

---

### Change 5: Restructure focal editor footer with Dashboard/Host-Location buttons

**File**: `MediaViewer.svelte` **Lines**: 1046-1066

**From**:
```svelte
<div class="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl flex items-center justify-end gap-3">
  <button onclick={cancelFocalEdit} class="...">Cancel</button>
  <button onclick={saveFocalEdit} class="...">
    {#if isCurrentHero}Save Position{:else if settingHeroFor === 'campus'}Set as Campus Hero{:else}Set as Hero Image{/if}
  </button>
</div>
```

**To**:
```svelte
<div class="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl flex items-center justify-between">
  <!-- Left side: Additional hero destinations -->
  <div class="flex gap-2">
    <button
      onclick={saveDashboardHero}
      class="px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition"
    >
      Dashboard
    </button>
    {#if onSetHostHeroImage}
      <button
        onclick={saveHostLocationHero}
        class="px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition"
      >
        Host-Location
      </button>
    {/if}
  </div>
  <!-- Right side: Cancel/Save -->
  <div class="flex gap-3">
    <button onclick={cancelFocalEdit} class="...">Cancel</button>
    <button onclick={saveFocalEdit} class="...">Save</button>
  </div>
</div>
```

---

### Change 6: Add Dashboard hero functions to MediaViewer

**File**: `MediaViewer.svelte` — Add new function after `saveFocalEdit`:

```typescript
/** Save current focal point as Dashboard hero */
async function saveDashboardHero() {
  if (!currentMedia) return;
  try {
    await window.electronAPI.settings.set('dashboard_hero_imgsha', currentMedia.hash);
    await window.electronAPI.settings.set('dashboard_hero_focal_x', String(pendingFocalX));
    await window.electronAPI.settings.set('dashboard_hero_focal_y', String(pendingFocalY));
    isEditingFocal = false;
    settingHeroFor = null;
  } catch (err) {
    console.error('Error setting dashboard hero:', err);
  }
}

/** Save current focal point as Host-Location hero (when viewing sub-location) */
async function saveHostLocationHero() {
  if (!currentMedia || !onSetHostHeroImage) return;
  onSetHostHeroImage(currentMedia.hash, pendingFocalX, pendingFocalY);
  isEditingFocal = false;
  settingHeroFor = null;
}
```

---

### Change 7: Add Dashboard hero display

**File**: `Dashboard.svelte` — Add hero section at top

Add imports and state:
```typescript
import { LocationHero } from '../components/location';

// Dashboard hero
let dashboardHero = $state<{imgsha: string; focalX: number; focalY: number} | null>(null);
let dashboardHeroImage = $state<{thumb_path?: string; preview_path?: string} | null>(null);
```

In onMount, load dashboard hero:
```typescript
try {
  const imgsha = await window.electronAPI.settings.get('dashboard_hero_imgsha');
  if (imgsha) {
    const focalX = parseFloat(await window.electronAPI.settings.get('dashboard_hero_focal_x') || '0.5');
    const focalY = parseFloat(await window.electronAPI.settings.get('dashboard_hero_focal_y') || '0.5');
    dashboardHero = { imgsha, focalX, focalY };
    // Load the image thumbnail
    dashboardHeroImage = await window.electronAPI.media.findByHash(imgsha);
  }
} catch (e) {
  console.error('Failed to load dashboard hero:', e);
}
```

Add hero display in template (before "Dashboard" h1):
```svelte
{#if dashboardHero && dashboardHeroImage}
  <div class="w-full bg-[#fffbf7] mb-6">
    <div class="relative w-full max-h-[30vh] mx-auto overflow-hidden" style="aspect-ratio: 2.35 / 1;">
      <img
        src={`media://${dashboardHeroImage.preview_path || dashboardHeroImage.thumb_path}?v=${cacheVersion}`}
        alt="Dashboard Hero"
        class="absolute inset-0 w-full h-full object-cover"
        style="object-position: {dashboardHero.focalX * 100}% {dashboardHero.focalY * 100}%;"
      />
      <!-- Gradient overlay -->
      <div class="absolute bottom-0 left-0 right-0 h-[80%] pointer-events-none" style="background: linear-gradient(to top, #fffbf7 0%, #fffbf7 12.5%, rgba(255,251,247,0.95) 20%, rgba(255,251,247,0.82) 30%, rgba(255,251,247,0.62) 42%, rgba(255,251,247,0.40) 54%, rgba(255,251,247,0.22) 66%, rgba(255,251,247,0.10) 78%, rgba(255,251,247,0.03) 90%, transparent 100%);"></div>
    </div>
  </div>
{/if}
```

---

### Change 8: Add IPC for finding image by hash

**File**: `electron/main/ipc-handlers/media.ts` — Add handler if not exists

```typescript
ipcMain.handle('media:findByHash', async (_event, hash: string) => {
  const img = await imageRepository.findByHash(hash);
  return img ? { thumb_path: img.thumb_path, preview_path: img.preview_path } : null;
});
```

**File**: `electron/preload/preload.cjs` — Add to media section

```javascript
findByHash: (hash) => ipcRenderer.invoke('media:findByHash', hash),
```

---

## Files Modified

1. `packages/desktop/src/components/MediaViewer.svelte` — Hero section cleanup, focal editor buttons
2. `packages/desktop/src/pages/Dashboard.svelte` — Add dashboard hero display
3. `packages/desktop/electron/main/ipc-handlers/media.ts` — Add findByHash handler (if needed)
4. `packages/desktop/electron/preload/preload.cjs` — Add findByHash to preload

## Settings Keys Used

| Key | Type | Description |
|-----|------|-------------|
| `dashboard_hero_imgsha` | string | SHA256 of dashboard hero image |
| `dashboard_hero_focal_x` | string (number) | Focal point X (0-1) |
| `dashboard_hero_focal_y` | string (number) | Focal point Y (0-1) |

## Verification Steps

1. Open lightbox on any image
2. Click "Show Info" → Verify hero section shows "Hero Image" button (no star)
3. If on sub-location, verify two buttons: "Hero Image" and "Host-Location"
4. Open focal editor → Verify no "Drag the pin" text
5. Verify footer has "Dashboard" button on left, "Cancel"/"Save" on right
6. If on sub-location, verify "Host-Location" button appears
7. Click "Dashboard" → Verify image is set as dashboard hero
8. Go to Dashboard page → Verify hero image displays with correct focal point
9. Click "Host-Location" (when on sub) → Verify parent location hero is updated
