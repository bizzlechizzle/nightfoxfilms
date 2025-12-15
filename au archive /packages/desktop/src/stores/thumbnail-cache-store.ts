/**
 * Thumbnail cache-busting store
 *
 * Provides a version timestamp that changes when thumbnails are regenerated.
 * Components append this to image URLs to force browser cache refresh.
 * OPT-020: Fixed incorrect store API usage
 */
import { writable, get } from 'svelte/store';

function createThumbnailCacheStore() {
  // OPT-020: Keep reference to store for proper get() usage
  const store = writable<number>(Date.now());
  const { subscribe, set } = store;

  return {
    subscribe,

    /**
     * Bump the cache version to force all images to reload
     * Call this after regenerating thumbnails
     */
    bust(): void {
      set(Date.now());
    },

    /**
     * Get current cache version (for use in non-reactive contexts)
     * OPT-020: Fixed - pass the store, not { subscribe }
     */
    getVersion(): number {
      return get(store);
    },
  };
}

export const thumbnailCache = createThumbnailCacheStore();
