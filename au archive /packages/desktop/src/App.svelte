<script lang="ts">
  /**
   * App.svelte - Main application component
   *
   * Per spec in desktop_app.md, pages are:
   * - page_dashboard, page_locations, page_web-browser, page_imports,
   *   page_search, page_settings, page_atlas
   * - page_location, page_sublocation, page_hostlocation
   *
   * Note: "Projects" in the dashboard spec means pinned/favorite items,
   * NOT a separate Projects page. Favorites are accessed via locations.
   *
   * Migration 24: Added multi-user authentication flow
   */
  import { onMount, onDestroy } from 'svelte';
  import { router } from './stores/router';
  import { importStore } from './stores/import-store';
  // FIX 5.4: Import toast store for backup notifications
  import { toasts } from './stores/toast-store';
  import Layout from './components/Layout.svelte';
  // ImportProgress moved to Navigation sidebar (SidebarImportProgress.svelte)
  // FIX 4.6: Toast notification system
  import ToastContainer from './components/ToastContainer.svelte';
  // P1: Global import modal
  import ImportModal from './components/ImportModal.svelte';
  import Dashboard from './pages/Dashboard.svelte';
  import Locations from './pages/Locations.svelte';
  import Atlas from './pages/Atlas.svelte';
  import Imports from './pages/Imports.svelte';
  import Settings from './pages/Settings.svelte';
  import Search from './pages/Search.svelte';
  import WebBrowser from './pages/WebBrowser.svelte';
  import Research from './pages/Research.svelte';
  import LocationDetail from './pages/LocationDetail.svelte';
  // SubLocationDetail merged into LocationDetail (Phase 3)
  import Setup from './pages/Setup.svelte';
  // Migration 24: Login page
  import Login from './pages/Login.svelte';

  let currentRoute = $state({ path: '/dashboard', params: {} });
  let setupComplete = $state(false);
  let checkingSetup = $state(true);

  // Migration 24: Authentication state
  let isAuthenticated = $state(false);
  let requiresLogin = $state(false);
  let currentUserId = $state<string | null>(null);
  let currentUsername = $state<string | null>(null);

  // Import progress listener
  let unsubscribeProgress: (() => void) | null = null;
  // ADR-050: Import v2 progress listener
  let unsubscribeV2Progress: (() => void) | null = null;
  // FIX: Import started listener (receives importId immediately for cancel to work)
  let unsubscribeStarted: (() => void) | null = null;
  // FIX 5.4: Backup status listener
  let unsubscribeBackup: (() => void) | null = null;
  // OPT-087: Asset ready listener for surgical cache invalidation
  let unsubscribeAssetReady: (() => void) | null = null;

  /**
   * Check if login is required based on user setting
   */
  async function checkAuthRequired(): Promise<boolean> {
    if (!window.electronAPI?.settings || !window.electronAPI?.users) {
      return false;
    }

    try {
      const requireLogin = await window.electronAPI.settings.get('require_login');
      return requireLogin === 'true';
    } catch (error) {
      console.error('Error checking auth requirement:', error);
      return false;
    }
  }

  /**
   * Handle successful login from Login page
   */
  function handleLogin(userId: string, username: string) {
    currentUserId = userId;
    currentUsername = username;
    isAuthenticated = true;

    // Save current user to settings
    if (window.electronAPI?.settings) {
      window.electronAPI.settings.set('current_user_id', userId);
      window.electronAPI.settings.set('current_user', username);
    }

    router.navigate('/dashboard');
  }

  /**
   * Handle setup completion - authenticate user directly
   * User just created their account, no need to ask for login immediately
   */
  function handleSetupComplete(userId: string, username: string) {
    setupComplete = true;
    currentUserId = userId;
    currentUsername = username;
    isAuthenticated = true;
    requiresLogin = false; // Don't show login after fresh setup

    router.navigate('/dashboard');
  }

  /**
   * Migration 24: Auto-login when no PIN is required
   */
  async function autoLogin() {
    if (!window.electronAPI?.settings) return;

    try {
      const userId = await window.electronAPI.settings.get('current_user_id');
      const username = await window.electronAPI.settings.get('current_user');

      if (userId && username) {
        currentUserId = userId;
        currentUsername = username;

        // Update last login
        if (window.electronAPI.users) {
          await window.electronAPI.users.updateLastLogin(userId);
        }
      }

      isAuthenticated = true;
    } catch (error) {
      console.error('Error during auto-login:', error);
      isAuthenticated = true; // Still allow access on error
    }
  }

  async function checkFirstRun() {
    try {
      if (!window.electronAPI?.settings) {
        console.error('Electron API not available - preload script may have failed to load');
        setupComplete = false;
        return;
      }
      const setupStatus = await window.electronAPI.settings.get('setup_complete');
      setupComplete = setupStatus === 'true';

      if (!setupComplete && currentRoute.path !== '/setup') {
        router.navigate('/setup');
        return;
      }

      // Migration 24: Check authentication after setup
      if (setupComplete) {
        requiresLogin = await checkAuthRequired();

        // Check if multiple users exist
        const users = await window.electronAPI.users.findAll();
        const hasMultipleUsers = users.length > 1;

        if (hasMultipleUsers) {
          // Multiple users - always show user selection (PIN check happens on Login page)
          requiresLogin = true;
        } else if (!requiresLogin) {
          // Single user, no PIN required - auto-login
          await autoLogin();
        }
        // If requiresLogin is true, the Login page will be shown
      }
    } catch (error) {
      console.error('Error checking setup status:', error);
    } finally {
      checkingSetup = false;
    }
  }

  onMount(() => {
    router.init();
    checkFirstRun();

    // FIX: Subscribe to import started event (receives importId immediately for cancel to work)
    if (window.electronAPI?.media?.onImportStarted) {
      unsubscribeStarted = window.electronAPI.media.onImportStarted((data) => {
        importStore.setImportId(data.importId);
      });
    }

    // Subscribe to import progress events from main process (legacy import system)
    // OPT-088: Calculate percent for legacy imports that don't provide weighted percent
    if (window.electronAPI?.media?.onImportProgress) {
      unsubscribeProgress = window.electronAPI.media.onImportProgress((progress) => {
        const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
        importStore.updateProgress(progress.current, progress.total, percent, progress.filename, progress.importId);
      });
    }

    // ADR-050: Subscribe to Import v2 progress events (5-step pipeline)
    // This is the new import system with incremental filesProcessed tracking
    if (window.electronAPI?.importV2?.onProgress) {
      unsubscribeV2Progress = window.electronAPI.importV2.onProgress((progress) => {
        // Map v2 progress fields to import store
        importStore.updateProgress(
          progress.filesProcessed,
          progress.filesTotal,
          Math.round(progress.percent),
          progress.currentFile,
          progress.sessionId
        );
      });
    }

    // FIX 5.4: Subscribe to backup status events from main process
    if (window.electronAPI?.backup?.onStatus) {
      unsubscribeBackup = window.electronAPI.backup.onStatus((status) => {
        if (status.success) {
          toasts.success(status.message, 5000);
        } else {
          toasts.error(status.message, 10000); // Longer duration for errors
        }
      });
    }

    // BagIt: Schedule validation if due (weekly background check)
    if (window.electronAPI?.bagit?.scheduleValidation) {
      window.electronAPI.bagit.scheduleValidation().catch((err: Error) => {
        console.warn('[BagIt] Failed to schedule validation:', err);
        // Non-fatal - don't show error to user
      });
    }

    // OPT-087: Subscribe to asset ready events for surgical cache invalidation
    // This enables thumbnails to "pop in" after background jobs complete
    if (window.electronAPI?.jobs?.onAssetReady) {
      unsubscribeAssetReady = window.electronAPI.jobs.onAssetReady((event) => {
        // Dispatch a custom event that components can listen to
        // This allows LocationDetail, Dashboard, etc. to refresh specific assets
        window.dispatchEvent(new CustomEvent('asset-ready', { detail: event }));
      });
    }
  });

  onDestroy(() => {
    if (unsubscribeStarted) {
      unsubscribeStarted();
    }
    if (unsubscribeProgress) {
      unsubscribeProgress();
    }
    // ADR-050: Cleanup v2 progress listener
    if (unsubscribeV2Progress) {
      unsubscribeV2Progress();
    }
    // FIX 5.4: Cleanup backup listener
    if (unsubscribeBackup) {
      unsubscribeBackup();
    }
    // OPT-087: Cleanup asset ready listener
    if (unsubscribeAssetReady) {
      unsubscribeAssetReady();
    }
  });

  $effect(() => {
    const unsubscribe = router.subscribe((route) => {
      currentRoute = route;
    });
    return () => unsubscribe();
  });
</script>

{#if checkingSetup}
  <div class="min-h-screen flex items-center justify-center bg-braun-50">
    <div class="text-center">
      <div class="inline-block rounded-full h-12 w-12 border-2 border-braun-300 mb-4 flex items-center justify-center">
        <div class="w-4 h-4 bg-braun-900 rounded-full"></div>
      </div>
      <p class="text-braun-600">Loading...</p>
    </div>
  </div>
{:else if currentRoute.path === '/setup'}
  <Setup onComplete={handleSetupComplete} />
{:else if !setupComplete}
  <Setup onComplete={handleSetupComplete} />
{:else if requiresLogin && !isAuthenticated}
  <!-- Migration 24: Show login page when PIN authentication is required -->
  <Login onLogin={handleLogin} />
{:else}
  <Layout>
    {#snippet children()}
      {#if currentRoute.path === '/dashboard'}
        <Dashboard />
      {:else if currentRoute.path === '/locations'}
        <Locations />
      {:else if currentRoute.path === '/atlas'}
        <Atlas />
      {:else if currentRoute.path === '/imports'}
        <Imports />
      {:else if currentRoute.path === '/search'}
        <Search />
      {:else if currentRoute.path === '/browser'}
        <WebBrowser />
      {:else if currentRoute.path === '/research'}
        <Research />
      {:else if currentRoute.path === '/settings'}
        <Settings />
      {:else if currentRoute.path === '/location/:id'}
        <LocationDetail locationId={currentRoute.params?.id || ''} />
      {:else if currentRoute.path === '/location/:locid/sub/:subid'}
        <!-- Unified: LocationDetail handles both location and sub-location views -->
        <LocationDetail locationId={currentRoute.params?.locid || ''} subId={currentRoute.params?.subid || ''} />
      {:else}
        <Dashboard />
      {/if}
    {/snippet}
  </Layout>
  <!-- Import progress moved to sidebar (SidebarImportProgress in Navigation.svelte) -->
  <!-- FIX 4.6: Global toast notifications -->
  <ToastContainer />
  <!-- P1: Global import modal -->
  <ImportModal />
{/if}
