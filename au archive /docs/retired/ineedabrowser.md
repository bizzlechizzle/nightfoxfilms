# Web Browser Implementation Specification

## Reference: page_web-browser.md

Per the original logseq specification, the web browser feature requirements are:

```
- embedded browser
- right side toolbar
  - save bookmark
    - search
      - search bar
      - autofill based on database
    - recents
      - list top 5
    - projects
      - list top 5
    - uploads
      - list top 5
    - save - add new
      - buttons
  - bookmark browser
    - state
      - type
        - location
```

## Current State: WRONG

The current `WebBrowser.svelte` implementation is a placeholder that says "planned for v0.2.0" and only provides external links to open in the system browser. This is NOT what was specified.

## Implementation Plan

### Phase 1: Core Browser Integration

#### 1.1 Electron BrowserView Setup

File: `electron/main/browser-view-manager.ts`

```typescript
import { BrowserView, BrowserWindow, ipcMain, session } from 'electron';

export class BrowserViewManager {
  private browserView: BrowserView | null = null;
  private mainWindow: BrowserWindow;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
    this.setupIpcHandlers();
  }

  private setupIpcHandlers(): void {
    ipcMain.handle('browser:navigate', async (_event, url: string) => {
      if (!this.browserView) {
        this.createBrowserView();
      }
      await this.browserView!.webContents.loadURL(url);
      return { success: true };
    });

    ipcMain.handle('browser:show', async (_event, bounds: { x: number; y: number; width: number; height: number }) => {
      if (!this.browserView) {
        this.createBrowserView();
      }
      this.browserView!.setBounds(bounds);
      this.mainWindow.addBrowserView(this.browserView!);
      return { success: true };
    });

    ipcMain.handle('browser:hide', async () => {
      if (this.browserView) {
        this.mainWindow.removeBrowserView(this.browserView);
      }
      return { success: true };
    });

    ipcMain.handle('browser:getUrl', async () => {
      return this.browserView?.webContents.getURL() || '';
    });

    ipcMain.handle('browser:getTitle', async () => {
      return this.browserView?.webContents.getTitle() || '';
    });

    ipcMain.handle('browser:goBack', async () => {
      if (this.browserView?.webContents.canGoBack()) {
        this.browserView.webContents.goBack();
        return true;
      }
      return false;
    });

    ipcMain.handle('browser:goForward', async () => {
      if (this.browserView?.webContents.canGoForward()) {
        this.browserView.webContents.goForward();
        return true;
      }
      return false;
    });

    ipcMain.handle('browser:reload', async () => {
      this.browserView?.webContents.reload();
    });

    ipcMain.handle('browser:captureScreenshot', async () => {
      if (!this.browserView) return null;
      const image = await this.browserView.webContents.capturePage();
      return image.toDataURL();
    });
  }

  private createBrowserView(): void {
    this.browserView = new BrowserView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    // Forward navigation events to renderer
    this.browserView.webContents.on('did-navigate', (_event, url) => {
      this.mainWindow.webContents.send('browser:navigated', url);
    });

    this.browserView.webContents.on('page-title-updated', (_event, title) => {
      this.mainWindow.webContents.send('browser:titleChanged', title);
    });

    this.browserView.webContents.on('did-start-loading', () => {
      this.mainWindow.webContents.send('browser:loadingChanged', true);
    });

    this.browserView.webContents.on('did-stop-loading', () => {
      this.mainWindow.webContents.send('browser:loadingChanged', false);
    });
  }

  destroy(): void {
    if (this.browserView) {
      this.mainWindow.removeBrowserView(this.browserView);
      this.browserView = null;
    }
  }
}
```

#### 1.2 Preload API Extension

Add to `electron/preload/index.ts`:

```typescript
browser: {
  navigate: (url: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('browser:navigate', url),
  show: (bounds: { x: number; y: number; width: number; height: number }): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('browser:show', bounds),
  hide: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('browser:hide'),
  getUrl: (): Promise<string> =>
    ipcRenderer.invoke('browser:getUrl'),
  getTitle: (): Promise<string> =>
    ipcRenderer.invoke('browser:getTitle'),
  goBack: (): Promise<boolean> =>
    ipcRenderer.invoke('browser:goBack'),
  goForward: (): Promise<boolean> =>
    ipcRenderer.invoke('browser:goForward'),
  reload: (): Promise<void> =>
    ipcRenderer.invoke('browser:reload'),
  captureScreenshot: (): Promise<string | null> =>
    ipcRenderer.invoke('browser:captureScreenshot'),
  onNavigated: (callback: (url: string) => void) => {
    const listener = (_event: any, url: string) => callback(url);
    ipcRenderer.on('browser:navigated', listener);
    return () => ipcRenderer.removeListener('browser:navigated', listener);
  },
  onTitleChanged: (callback: (title: string) => void) => {
    const listener = (_event: any, title: string) => callback(title);
    ipcRenderer.on('browser:titleChanged', listener);
    return () => ipcRenderer.removeListener('browser:titleChanged', listener);
  },
  onLoadingChanged: (callback: (loading: boolean) => void) => {
    const listener = (_event: any, loading: boolean) => callback(loading);
    ipcRenderer.on('browser:loadingChanged', listener);
    return () => ipcRenderer.removeListener('browser:loadingChanged', listener);
  },
},
```

### Phase 2: UI Implementation

#### 2.1 WebBrowser.svelte Replacement

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  // Browser state
  let currentUrl = $state('https://maps.google.com');
  let urlInput = $state('https://maps.google.com');
  let pageTitle = $state('');
  let isLoading = $state(false);
  let browserContainerRef: HTMLDivElement;

  // Sidebar state
  let searchQuery = $state('');
  let recentBookmarks = $state<Bookmark[]>([]);
  let pinnedLocations = $state<Location[]>([]);
  let recentUploads = $state<Import[]>([]);
  let showSaveBookmark = $state(false);
  let bookmarkLocid = $state<string | null>(null);
  let autocompleteResults = $state<Location[]>([]);

  interface Bookmark {
    bookmark_id: string;
    url: string;
    title: string | null;
    locid: string | null;
    created_date: string;
  }

  interface Location {
    locid: string;
    locnam: string;
    state?: string;
    type?: string;
  }

  interface Import {
    import_id: string;
    locid: string;
    import_date: string;
  }

  let cleanupFunctions: Array<() => void> = [];

  onMount(async () => {
    // Set up browser event listeners
    if (window.electronAPI?.browser) {
      cleanupFunctions.push(
        window.electronAPI.browser.onNavigated((url) => {
          currentUrl = url;
          urlInput = url;
        })
      );
      cleanupFunctions.push(
        window.electronAPI.browser.onTitleChanged((title) => {
          pageTitle = title;
        })
      );
      cleanupFunctions.push(
        window.electronAPI.browser.onLoadingChanged((loading) => {
          isLoading = loading;
        })
      );

      // Position and show browser view
      updateBrowserBounds();
      window.addEventListener('resize', updateBrowserBounds);

      // Navigate to initial URL
      await window.electronAPI.browser.navigate(currentUrl);
    }

    // Load sidebar data
    await loadSidebarData();
  });

  onDestroy(() => {
    cleanupFunctions.forEach(fn => fn());
    window.removeEventListener('resize', updateBrowserBounds);
    window.electronAPI?.browser?.hide();
  });

  function updateBrowserBounds() {
    if (!browserContainerRef || !window.electronAPI?.browser) return;

    const rect = browserContainerRef.getBoundingClientRect();
    window.electronAPI.browser.show({
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
  }

  async function loadSidebarData() {
    if (!window.electronAPI) return;

    try {
      // Load recent bookmarks (top 5)
      if (window.electronAPI.bookmarks) {
        recentBookmarks = await window.electronAPI.bookmarks.findRecent(5) as Bookmark[];
      }

      // Load pinned/recent locations (top 5)
      if (window.electronAPI.locations) {
        pinnedLocations = (await window.electronAPI.locations.favorites()).slice(0, 5) as Location[];
      }

      // Load recent imports (top 5)
      if (window.electronAPI.imports) {
        recentUploads = await window.electronAPI.imports.findRecent(5) as Import[];
      }
    } catch (error) {
      console.error('Error loading sidebar data:', error);
    }
  }

  async function navigate() {
    if (!window.electronAPI?.browser) return;

    let url = urlInput.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }

    await window.electronAPI.browser.navigate(url);
  }

  async function goBack() {
    await window.electronAPI?.browser?.goBack();
  }

  async function goForward() {
    await window.electronAPI?.browser?.goForward();
  }

  async function reload() {
    await window.electronAPI?.browser?.reload();
  }

  async function handleSearchInput() {
    if (!searchQuery.trim() || !window.electronAPI?.locations) {
      autocompleteResults = [];
      return;
    }

    try {
      const results = await window.electronAPI.locations.findAll({ search: searchQuery });
      autocompleteResults = results.slice(0, 10);
    } catch (error) {
      console.error('Error searching locations:', error);
    }
  }

  async function saveBookmark() {
    if (!window.electronAPI?.bookmarks) return;

    try {
      await window.electronAPI.bookmarks.create({
        url: currentUrl,
        title: pageTitle || null,
        locid: bookmarkLocid,
      });
      showSaveBookmark = false;
      bookmarkLocid = null;
      await loadSidebarData();
    } catch (error) {
      console.error('Error saving bookmark:', error);
    }
  }

  function openBookmark(url: string) {
    urlInput = url;
    navigate();
  }
</script>

<div class="h-full flex">
  <!-- Browser Area -->
  <div class="flex-1 flex flex-col">
    <!-- Browser Toolbar -->
    <div class="bg-gray-100 border-b border-gray-200 px-3 py-2 flex items-center gap-2">
      <button onclick={goBack} class="p-1.5 hover:bg-gray-200 rounded" title="Back">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      <button onclick={goForward} class="p-1.5 hover:bg-gray-200 rounded" title="Forward">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
        </svg>
      </button>
      <button onclick={reload} class="p-1.5 hover:bg-gray-200 rounded" title="Reload">
        <svg class="w-4 h-4 {isLoading ? 'animate-spin' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </button>

      <form onsubmit={(e) => { e.preventDefault(); navigate(); }} class="flex-1 flex">
        <input
          type="text"
          bind:value={urlInput}
          class="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-l focus:outline-none focus:ring-1 focus:ring-accent"
          placeholder="Enter URL..."
        />
        <button type="submit" class="px-4 py-1.5 bg-accent text-white text-sm rounded-r hover:opacity-90">
          Go
        </button>
      </form>
    </div>

    <!-- Browser View Container -->
    <div bind:this={browserContainerRef} class="flex-1 bg-white">
      <!-- BrowserView will be positioned here -->
    </div>
  </div>

  <!-- Right Sidebar Toolbar -->
  <aside class="w-80 bg-white border-l border-gray-200 flex flex-col overflow-hidden">
    <div class="p-4 border-b border-gray-200">
      <h2 class="text-lg font-semibold text-foreground">Research Tools</h2>
    </div>

    <div class="flex-1 overflow-y-auto p-4 space-y-6">
      <!-- Save Bookmark Section -->
      <div>
        <button
          onclick={() => showSaveBookmark = !showSaveBookmark}
          class="w-full px-4 py-2 bg-accent text-white rounded hover:opacity-90 transition text-sm font-medium"
        >
          Save Bookmark
        </button>

        {#if showSaveBookmark}
          <div class="mt-3 p-3 bg-gray-50 rounded border">
            <p class="text-xs text-gray-600 mb-2 truncate">{currentUrl}</p>
            <p class="text-sm font-medium mb-2">{pageTitle || 'Untitled'}</p>

            <label class="block text-xs text-gray-700 mb-1">Link to Location:</label>
            <input
              type="text"
              bind:value={searchQuery}
              oninput={handleSearchInput}
              placeholder="Search locations..."
              class="w-full px-2 py-1 text-sm border rounded mb-2"
            />

            {#if autocompleteResults.length > 0}
              <div class="max-h-32 overflow-y-auto border rounded mb-2">
                {#each autocompleteResults as loc}
                  <button
                    onclick={() => { bookmarkLocid = loc.locid; searchQuery = loc.locnam; autocompleteResults = []; }}
                    class="w-full text-left px-2 py-1 text-sm hover:bg-gray-100 truncate"
                  >
                    {loc.locnam}
                  </button>
                {/each}
              </div>
            {/if}

            <div class="flex gap-2">
              <button onclick={saveBookmark} class="flex-1 px-3 py-1 bg-accent text-white text-sm rounded">
                Save
              </button>
              <button onclick={() => showSaveBookmark = false} class="px-3 py-1 bg-gray-200 text-sm rounded">
                Cancel
              </button>
            </div>
          </div>
        {/if}
      </div>

      <!-- Search Database Section -->
      <div>
        <h3 class="text-sm font-medium text-gray-700 mb-2">Search Database</h3>
        <input
          type="text"
          bind:value={searchQuery}
          oninput={handleSearchInput}
          placeholder="Search locations..."
          class="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      <!-- Recent Bookmarks Section -->
      <div>
        <h3 class="text-sm font-medium text-gray-700 mb-2">Recents (Top 5)</h3>
        {#if recentBookmarks.length === 0}
          <p class="text-xs text-gray-400">No recent bookmarks</p>
        {:else}
          <div class="space-y-1">
            {#each recentBookmarks as bookmark}
              <button
                onclick={() => openBookmark(bookmark.url)}
                class="w-full text-left px-2 py-1.5 text-sm bg-gray-50 rounded hover:bg-gray-100 truncate"
              >
                {bookmark.title || bookmark.url}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Pinned Locations Section (was "projects" in spec - means pinned items) -->
      <div>
        <h3 class="text-sm font-medium text-gray-700 mb-2">Pinned (Top 5)</h3>
        {#if pinnedLocations.length === 0}
          <p class="text-xs text-gray-400">No pinned locations</p>
        {:else}
          <div class="space-y-1">
            {#each pinnedLocations as loc}
              <div class="px-2 py-1.5 text-sm bg-gray-50 rounded">
                {loc.locnam}
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Recent Uploads Section -->
      <div>
        <h3 class="text-sm font-medium text-gray-700 mb-2">Uploads (Top 5)</h3>
        {#if recentUploads.length === 0}
          <p class="text-xs text-gray-400">No recent uploads</p>
        {:else}
          <div class="space-y-1">
            {#each recentUploads as upload}
              <div class="px-2 py-1.5 text-sm bg-gray-50 rounded truncate">
                Import: {upload.import_id.slice(0, 8)}...
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </aside>
</div>
```

### Phase 3: File Changes Required

1. **electron/preload/index.ts** - Fix CommonJS issue AND add browser API
2. **electron/main/index.ts** - Initialize BrowserViewManager
3. **src/pages/WebBrowser.svelte** - Replace placeholder with real browser
4. **src/components/Navigation.svelte** - Rename "Projects" to "Pinned"
5. **src/pages/Projects.svelte** - Remove or repurpose to PinnedPosts
6. **vite.config.ts** - Ensure proper CJS output for preload

### Phase 4: Bookmark Browser by State/Type/Location

Per spec: `bookmark browser - state - type - location`

This means bookmarks should be browsable/filterable by:
- State (US state of linked location)
- Type (location type of linked location)
- Location (direct location link)

Add filtering UI to WebBrowser sidebar or create separate Bookmarks.svelte with these filters.

## Implementation Order

1. **FIX PRELOAD SCRIPT FIRST** - Nothing works without this
2. Implement BrowserViewManager in main process
3. Add browser API to preload
4. Replace WebBrowser.svelte with real implementation
5. Rename Projects -> Pinned Posts (favorites)
6. Test Atlas map (should work after preload fix)
7. Test first boot flow (should work after preload fix)

## Notes

- The "projects" terminology in the spec refers to pinned/favorite items, NOT a separate project management system
- The current Projects.svelte and sqlite-projects-repository.ts are over-engineered beyond the spec
- Keep the existing favorites functionality in locations - that IS the "projects" feature
- Right-click to add location on map is marked as "planned for later version" in the spec
