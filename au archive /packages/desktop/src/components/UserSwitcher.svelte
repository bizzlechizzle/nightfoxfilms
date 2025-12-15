<script lang="ts">
  /**
   * UserSwitcher.svelte - User switching modal
   * Allows switching between users with PIN verification when required
   */
  import { onMount } from 'svelte';
  import { userStore, type User } from '../stores/user-store';
  import { toasts } from '../stores/toast-store';

  interface Props {
    isOpen: boolean;
    onClose: () => void;
  }

  let { isOpen, onClose }: Props = $props();

  let users = $state<User[]>([]);
  let currentUserId = $state<string | null>(null);
  let selectedUserId = $state<string | null>(null);
  let pin = $state('');
  let error = $state('');
  let loading = $state(true);
  let verifying = $state(false);
  let requireLogin = $state(false); // Global setting: is PIN required at startup?

  // Get selected user object
  const selectedUser = $derived(users.find((u) => u.user_id === selectedUserId) || null);

  // Check if selected user needs PIN and is different from current
  // Only require PIN if: global require_login is enabled AND user has PIN AND switching to different user
  const needsPin = $derived(
    requireLogin && selectedUser && selectedUser.has_pin && selectedUser.user_id !== currentUserId
  );

  // PIN display (show dots for entered digits)
  const pinDisplay = $derived(
    '●'.repeat(pin.length) + '○'.repeat(Math.max(0, 4 - pin.length))
  );

  async function loadUsers() {
    try {
      loading = true;

      // Load users and require_login setting in parallel
      const [usersList, requireLoginSetting] = await Promise.all([
        window.electronAPI.users.findAll(),
        window.electronAPI.settings.get('require_login'),
      ]);

      users = usersList;
      requireLogin = requireLoginSetting === 'true';

      const state = userStore.getState();
      currentUserId = state.currentUserId;
      selectedUserId = currentUserId;
    } catch (err) {
      console.error('Error loading users:', err);
      error = 'Failed to load users';
    } finally {
      loading = false;
    }
  }

  async function handleSwitch() {
    if (!selectedUser) {
      error = 'Please select a user';
      return;
    }

    // Same user, just close
    if (selectedUser.user_id === currentUserId) {
      onClose();
      return;
    }

    error = '';

    // Only require PIN if global setting is enabled AND user has PIN
    if (needsPin) {
      if (pin.length < 4) {
        error = 'Please enter the PIN';
        return;
      }

      verifying = true;
      try {
        const result = await window.electronAPI.users.verifyPin(
          selectedUser.user_id,
          pin
        );
        if (result.success) {
          await userStore.switchUser(selectedUser.user_id, selectedUser.username);
          toasts.success(`Switched to ${selectedUser.display_name || selectedUser.username}`);
          onClose();
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
      // No PIN required (either user has no PIN or global setting is disabled)
      const success = await userStore.switchUser(
        selectedUser.user_id,
        selectedUser.username
      );
      if (success) {
        toasts.success(`Switched to ${selectedUser.display_name || selectedUser.username}`);
        onClose();
      } else {
        error = 'Failed to switch user';
      }
    }
  }

  function handlePinInput(digit: string) {
    if (pin.length < 6) {
      pin += digit;
      error = '';

      // Auto-submit when PIN is 4+ digits
      if (pin.length >= 4) {
        handleSwitch();
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
    if (!isOpen) return;

    if (event.key >= '0' && event.key <= '9') {
      handlePinInput(event.key);
    } else if (event.key === 'Backspace') {
      handleBackspace();
    } else if (event.key === 'Enter' && (!needsPin || pin.length >= 4)) {
      handleSwitch();
    } else if (event.key === 'Escape') {
      onClose();
    }
  }

  async function selectUser(userId: string) {
    selectedUserId = userId;
    pin = '';
    error = '';

    // If same user, just close
    if (userId === currentUserId) {
      onClose();
      return;
    }

    const user = users.find((u) => u.user_id === userId);

    // If no PIN required, switch immediately
    if (user && !(requireLogin && user.has_pin)) {
      const success = await userStore.switchUser(user.user_id, user.username);
      if (success) {
        toasts.success(`Switched to ${user.display_name || user.username}`);
        onClose();
      } else {
        error = 'Failed to switch user';
      }
    }
  }

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  $effect(() => {
    if (isOpen) {
      loadUsers();
      pin = '';
      error = '';
    }
  });
</script>

<svelte:window on:keydown={handleKeydown} />

{#if isOpen}
  <!-- Modal Backdrop -->
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
    onclick={handleBackdropClick}
    role="dialog"
    aria-modal="true"
    aria-label="Switch user"
  >
    <!-- Modal Content -->
    <div class="bg-white rounded border border-braun-300 w-full max-w-sm shadow-xl">
      <!-- Close button -->
      <div class="flex justify-end px-4 pt-4">
        <button
          onclick={onClose}
          class="p-1 text-braun-400 hover:text-braun-600 transition"
          aria-label="Close"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      <!-- Body -->
      <div class="px-6 pb-6">
        {#if loading}
          <div class="text-center py-8">
            <p class="text-braun-500">Loading...</p>
          </div>
        {:else if users.length === 0}
          <div class="text-center py-8">
            <p class="text-braun-500">No users found.</p>
          </div>
        {:else}
          <!-- User List -->
          <div class="space-y-2 mb-4">
            {#each users as user}
              <button
                onclick={() => selectUser(user.user_id)}
                class="w-full flex items-center gap-3 p-3 rounded border transition
                       {selectedUserId === user.user_id
                  ? 'border-braun-900 bg-braun-50'
                  : 'border-braun-200 hover:border-braun-400'}"
              >
                <!-- User Avatar -->
                <div
                  class="w-10 h-10 rounded-full bg-braun-200 flex items-center justify-center flex-shrink-0"
                >
                  <span class="text-braun-600 font-medium text-sm">
                    {(user.display_name || user.username).charAt(0).toUpperCase()}
                  </span>
                </div>

                <!-- User Info -->
                <div class="flex-1 text-left">
                  <div class="flex items-center gap-2">
                    <span class="font-medium text-braun-900">
                      {user.display_name || user.username}
                    </span>
                    {#if user.user_id === currentUserId}
                      <span
                        class="text-xs bg-braun-100 text-braun-600 px-1.5 py-0.5 rounded"
                      >
                        Current
                      </span>
                    {/if}
                  </div>
                  {#if user.display_name}
                    <p class="text-xs text-braun-500">@{user.username}</p>
                  {/if}
                </div>

                <!-- PIN Indicator -->
                {#if user.has_pin}
                  <svg
                    class="w-4 h-4 text-braun-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    title="PIN protected"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                {/if}
              </button>
            {/each}
          </div>

          <!-- PIN Entry (only show if selected user has PIN and is different from current) -->
          {#if needsPin}
            <div class="border-t border-braun-200 pt-4 mt-4">
              <label class="block text-sm font-medium text-braun-700 mb-2 text-center">
                Enter PIN for {selectedUser?.display_name || selectedUser?.username}
              </label>

              <!-- PIN Display -->
              <div
                class="text-center text-2xl tracking-widest mb-4 font-mono text-braun-700"
              >
                {pinDisplay}
              </div>

              <!-- PIN Keypad -->
              <div class="grid grid-cols-3 gap-2 max-w-[200px] mx-auto">
                {#each ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as digit}
                  <button
                    onclick={() => handlePinInput(digit)}
                    class="p-3 text-lg font-medium bg-braun-100 rounded hover:bg-braun-200 transition"
                  >
                    {digit}
                  </button>
                {/each}
                <button
                  onclick={handleClear}
                  class="p-3 text-xs font-medium bg-braun-100 rounded hover:bg-braun-200 transition text-braun-500"
                >
                  Clear
                </button>
                <button
                  onclick={() => handlePinInput('0')}
                  class="p-3 text-lg font-medium bg-braun-100 rounded hover:bg-braun-200 transition"
                >
                  0
                </button>
                <button
                  onclick={handleBackspace}
                  class="p-3 text-lg font-medium bg-braun-100 rounded hover:bg-braun-200 transition"
                >
                  ←
                </button>
              </div>
            </div>
          {/if}

          <!-- Error Message -->
          {#if error}
            <div class="mt-4 text-center text-red-500 text-sm">
              {error}
            </div>
          {/if}
        {/if}
      </div>

    </div>
  </div>
{/if}
