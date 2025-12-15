<script lang="ts">
  /**
   * Login.svelte - User authentication page
   * Migration 24: Multi-user PIN authentication
   *
   * Shows user selection and PIN entry for multi-user mode
   */
  import { onMount } from 'svelte';

  interface User {
    user_id: string;
    username: string;
    display_name: string | null;
    has_pin: boolean;
  }

  interface Props {
    onLogin: (userId: string, username: string) => void;
  }

  let { onLogin }: Props = $props();

  let users = $state<User[]>([]);
  let selectedUserId = $state<string | null>(null);
  let pin = $state('');
  let error = $state('');
  let loading = $state(true);
  let verifying = $state(false);
  let requireLogin = $state(false); // Global "Startup PIN Required" setting

  // Get selected user object
  const selectedUser = $derived(users.find(u => u.user_id === selectedUserId) || null);

  // PIN display (show dots for entered digits)
  const pinDisplay = $derived('●'.repeat(pin.length) + '○'.repeat(Math.max(0, 4 - pin.length)));

  // Only require PIN if global setting is enabled AND user has a PIN
  const needsPin = $derived(requireLogin && selectedUser?.has_pin);

  async function loadUsers() {
    try {
      loading = true;

      // Load users and require_login setting in parallel
      const [userList, requireLoginSetting] = await Promise.all([
        window.electronAPI.users.findAll(),
        window.electronAPI.settings.get('require_login')
      ]);

      users = userList;
      requireLogin = requireLoginSetting === 'true';

      // Auto-select if only one user
      if (users.length === 1) {
        selectedUserId = users[0].user_id;
      }
    } catch (err) {
      console.error('Error loading users:', err);
      error = 'Failed to load users';
    } finally {
      loading = false;
    }
  }

  async function handleLogin() {
    if (!selectedUser) {
      error = 'Please select a user';
      return;
    }

    error = '';

    // If PIN is required (global setting enabled AND user has PIN), verify it
    if (needsPin) {
      if (pin.length < 4) {
        error = 'Please enter your PIN';
        return;
      }

      verifying = true;
      try {
        const result = await window.electronAPI.users.verifyPin(selectedUser.user_id, pin);
        if (result.success) {
          onLogin(selectedUser.user_id, selectedUser.username);
        } else {
          error = 'Incorrect PIN';
          pin = '';
        }
      } catch (err) {
        console.error('Error verifying PIN:', err);
        error = 'Failed to verify PIN';
      } finally {
        verifying = false;
      }
    } else {
      // No PIN required, just log in
      await window.electronAPI.users.updateLastLogin(selectedUser.user_id);
      onLogin(selectedUser.user_id, selectedUser.username);
    }
  }

  async function selectUser(userId: string) {
    selectedUserId = userId;
    const user = users.find(u => u.user_id === userId);

    // If no PIN required for this user, sign in immediately
    if (user && !(requireLogin && user.has_pin)) {
      await window.electronAPI.users.updateLastLogin(user.user_id);
      onLogin(user.user_id, user.username);
    }
  }

  function handlePinInput(digit: string) {
    if (pin.length < 6) {
      pin += digit;
      error = '';

      // Auto-submit when PIN is 4+ digits
      if (pin.length >= 4) {
        handleLogin();
      }
    }
  }

  function handleBackspace() {
    pin = pin.slice(0, -1);
  }

  function handleClear() {
    pin = '';
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key >= '0' && event.key <= '9') {
      handlePinInput(event.key);
    } else if (event.key === 'Backspace') {
      handleBackspace();
    } else if (event.key === 'Enter' && pin.length >= 4) {
      handleLogin();
    }
  }

  onMount(() => {
    loadUsers();
  });
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="min-h-screen bg-braun-50 flex flex-col items-center justify-center p-8">
  <!-- Text Logo - above card -->
  <div class="text-center mb-8">
    <span class="text-4xl font-bold tracking-tight text-braun-900">ABANDONED ARCHIVE</span>
  </div>

  <!-- Main Card - centered -->
  <div class="w-full max-w-md">
    <div class="bg-white rounded border border-braun-300 p-6">
      {#if loading}
        <div class="text-center py-8">
          <p class="text-braun-500">Loading...</p>
        </div>
      {:else if users.length === 0}
        <div class="text-center py-8">
          <p class="text-braun-500">No users found. Please run setup.</p>
        </div>
      {:else}
        <!-- User Selection -->
        <div class="mb-6">
          {#if users.length <= 4}
            <!-- User Cards for 1-4 users -->
            <div class="space-y-2">
              {#each users as user}
                <button
                  onclick={() => selectUser(user.user_id)}
                  class="w-full flex items-center gap-3 p-3 rounded border transition
                         {selectedUserId === user.user_id
                    ? 'border-braun-900 bg-braun-50'
                    : 'border-braun-200 hover:border-braun-400'}"
                >
                  <!-- Avatar -->
                  <div class="w-10 h-10 rounded-full bg-braun-200 flex items-center justify-center flex-shrink-0">
                    <span class="text-braun-600 font-medium">
                      {(user.display_name || user.username).charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <!-- Name -->
                  <span class="font-medium text-braun-900">
                    {user.display_name || user.username}
                  </span>
                </button>
              {/each}
            </div>
          {:else}
            <!-- Dropdown for 5+ users -->
            <label for="user-select" class="block text-sm font-medium text-braun-700 mb-2">
              Select User
            </label>
            <select
              id="user-select"
              bind:value={selectedUserId}
              onchange={(e) => e.currentTarget.value && selectUser(e.currentTarget.value)}
              class="w-full px-4 py-3 border border-braun-300 rounded focus:outline-none focus:border-braun-600 text-lg"
            >
              <option value="">Choose a user...</option>
              {#each users as user}
                <option value={user.user_id}>
                  {user.display_name || user.username}
                </option>
              {/each}
            </select>
          {/if}
        </div>

        <!-- PIN Entry (only show if PIN is required) -->
        {#if needsPin}
          <div class="mb-6">
            <label class="block text-sm font-medium text-braun-700 mb-2 text-center">
              Enter PIN
            </label>

            <!-- PIN Display -->
            <div class="text-center text-3xl tracking-widest mb-4 font-mono text-braun-700">
              {pinDisplay}
            </div>

            <!-- PIN Keypad -->
            <div class="grid grid-cols-3 gap-2 max-w-xs mx-auto">
              {#each ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as digit}
                <button
                  onclick={() => handlePinInput(digit)}
                  class="p-4 text-xl font-medium bg-braun-100 rounded hover:bg-braun-200 transition"
                >
                  {digit}
                </button>
              {/each}
              <button
                onclick={handleClear}
                class="p-4 text-sm font-medium bg-braun-100 rounded hover:bg-braun-200 transition text-braun-500"
              >
                Clear
              </button>
              <button
                onclick={() => handlePinInput('0')}
                class="p-4 text-xl font-medium bg-braun-100 rounded hover:bg-braun-200 transition"
              >
                0
              </button>
              <button
                onclick={handleBackspace}
                class="p-4 text-xl font-medium bg-braun-100 rounded hover:bg-braun-200 transition"
              >
                ←
              </button>
            </div>
          </div>
        {/if}

        <!-- Error Message -->
        {#if error}
          <div class="text-center text-red-500 text-sm">
            {error}
          </div>
        {/if}
      {/if}
    </div>

  </div>
</div>
