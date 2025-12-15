<script lang="ts">
  import { onMount } from 'svelte';
  import { router } from '../stores/router';
  import { openImportModal } from '../stores/import-modal-store';
  import { userStore, currentUser } from '../stores/user-store';
  import UserSwitcher from './UserSwitcher.svelte';

  let currentRoute = $state('/dashboard');
  let showUserSwitcher = $state(false);

  $effect(() => {
    const unsubscribe = router.subscribe((route) => {
      currentRoute = route.path;
    });
    return () => unsubscribe();
  });

  // Navigation order: Dashboard, Locations, Research, Atlas
  // Search and Settings in bottom icon bar
  const menuItems = [
    { path: '/dashboard', label: 'Dashboard' },
    { path: '/locations', label: 'Locations' },
    { path: '/research', label: 'Research' },
    { path: '/atlas', label: 'Atlas' },
  ];

  function navigate(path: string) {
    router.navigate(path);
  }

  function isActive(path: string): boolean {
    return currentRoute === path;
  }

  function openUserSwitcher() {
    showUserSwitcher = true;
  }

  function closeUserSwitcher() {
    showUserSwitcher = false;
  }

  // Initialize user store on mount
  onMount(() => {
    userStore.init();
  });
</script>

<nav class="w-64 h-screen bg-braun-50 text-braun-900 flex flex-col border-r border-braun-300">
  <!-- macOS: Top padding for traffic light buttons (hiddenInset titlebar) -->
  <div class="pt-8 drag-region-nav">
    <!-- Wordmark: Stacked layout (Braun style) -->
    <div class="p-6 border-b border-braun-300">
      <span class="text-2xl font-bold tracking-tight uppercase text-braun-900 leading-tight block">
        Abandoned<br/>Archive
      </span>
    </div>
  </div>

  <!-- P1: New Location button - primary action (near-black) -->
  <div class="px-4 py-4">
    <button
      onclick={() => openImportModal()}
      class="w-full px-4 py-3 bg-braun-900 text-white rounded text-sm font-medium hover:bg-braun-600 transition-colors flex items-center justify-center"
    >
      New Location
    </button>
  </div>

  <div class="flex-1 overflow-y-auto">
    <ul class="py-2">
      {#each menuItems as item}
        <li>
          <button
            onclick={() => navigate(item.path)}
            class="w-full px-6 py-2 text-left text-sm font-medium transition-colors
                   {isActive(item.path)
                     ? 'bg-braun-100 text-braun-900'
                     : 'text-braun-600 hover:bg-braun-100 hover:text-braun-900'}"
          >
            {item.label}
          </button>
        </li>
      {/each}
    </ul>
  </div>

  <!-- Bottom Icon Bar: Search and Settings (icons only, right-justified) -->
  <div class="p-4 border-t border-braun-200">
    <div class="flex justify-end items-center gap-2">
      <button
        onclick={() => navigate('/search')}
        class="p-2 rounded hover:bg-braun-100 transition-colors {isActive('/search') ? 'bg-braun-100' : ''}"
        title="Search"
      >
        <svg class="w-5 h-5 text-braun-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </button>
      <button
        onclick={() => navigate('/settings')}
        class="p-2 rounded hover:bg-braun-100 transition-colors {isActive('/settings') ? 'bg-braun-100' : ''}"
        title="Settings"
      >
        <svg class="w-5 h-5 text-braun-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
      <!-- User Icon Button -->
      <button
        onclick={openUserSwitcher}
        class="p-2 rounded hover:bg-braun-100 transition-colors {showUserSwitcher ? 'bg-braun-100' : ''}"
        title={$currentUser ? ($currentUser.display_name || $currentUser.username) : 'User'}
      >
        <svg class="w-5 h-5 text-braun-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      </button>
    </div>
  </div>
</nav>

<!-- User Switcher Modal -->
<UserSwitcher isOpen={showUserSwitcher} onClose={closeUserSwitcher} />

<style>
  .drag-region-nav {
    -webkit-app-region: drag;
  }
</style>
