/**
 * User Store
 * Centralized user state management for user switching
 */
import { writable, derived, get } from 'svelte/store';
import type { UserRecord } from '../types/electron';

// Re-export UserRecord as User for convenience
export type User = UserRecord;

interface UserState {
  currentUserId: string | null;
  currentUsername: string | null;
  users: User[];
  loading: boolean;
}

const initialState: UserState = {
  currentUserId: null,
  currentUsername: null,
  users: [],
  loading: false,
};

function createUserStore() {
  const { subscribe, set, update } = writable<UserState>(initialState);

  return {
    subscribe,

    /**
     * Initialize user state from settings
     */
    async init() {
      update((state) => ({ ...state, loading: true }));

      try {
        const [userId, username, users] = await Promise.all([
          window.electronAPI.settings.get('current_user_id'),
          window.electronAPI.settings.get('current_user'),
          window.electronAPI.users.findAll(),
        ]);

        update((state) => ({
          ...state,
          currentUserId: userId || null,
          currentUsername: username || null,
          users: users || [],
          loading: false,
        }));
      } catch (error) {
        console.error('[UserStore] Failed to initialize:', error);
        update((state) => ({ ...state, loading: false }));
      }
    },

    /**
     * Reload users list from database
     */
    async reloadUsers() {
      try {
        const users = await window.electronAPI.users.findAll();
        update((state) => ({ ...state, users: users || [] }));
      } catch (error) {
        console.error('[UserStore] Failed to reload users:', error);
      }
    },

    /**
     * Switch to a different user
     * @param userId - Target user ID
     * @param username - Target username
     */
    async switchUser(userId: string, username: string) {
      try {
        // Update settings
        await Promise.all([
          window.electronAPI.settings.set('current_user_id', userId),
          window.electronAPI.settings.set('current_user', username),
          window.electronAPI.users.updateLastLogin(userId),
        ]);

        // Update store
        update((state) => ({
          ...state,
          currentUserId: userId,
          currentUsername: username,
        }));

        return true;
      } catch (error) {
        console.error('[UserStore] Failed to switch user:', error);
        return false;
      }
    },

    /**
     * Get current state snapshot
     */
    getState(): UserState {
      return get({ subscribe });
    },

    /**
     * Reset store to initial state
     */
    reset() {
      set(initialState);
    },
  };
}

export const userStore = createUserStore();

// Derived stores for convenience
export const currentUser = derived(userStore, ($store) => {
  if (!$store.currentUserId) return null;
  return $store.users.find((u) => u.user_id === $store.currentUserId) || null;
});

export const hasMultipleUsers = derived(userStore, ($store) => $store.users.length > 1);
